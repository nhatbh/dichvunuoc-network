using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace WaterPlatform.BuildingBlocks.WebApi.Http;

/// <summary>
/// Single source of truth for writing RFC 7807 ProblemDetails responses from
/// the platform (GlobalExceptionMiddleware, ValidationEndpointFilter).
/// <remarks>
/// Implements user story US-X-02: unified error contract across all services.
/// All 4xx/5xx responses produced by platform middleware MUST flow through
/// <see cref="WriteAsync"/> so clients see a consistent shape with correlation
/// ID, trace ID, machine-readable <c>code</c>, and optional <c>errors</c>.
/// </remarks>
/// </summary>
public static class ProblemDetailsWriter
{
    public const string ContentType = "application/problem+json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    /// <summary>
    /// Writes a ProblemDetails payload. Reads correlation ID from
    /// <c>HttpContext.Items["RequestContext"]</c> (set by
    /// <c>CorrelationIdMiddleware</c>) and falls back to
    /// <c>Activity.Current?.Id</c> if absent.
    /// </summary>
    public static async Task WriteAsync(
        HttpContext context,
        int statusCode,
        string title,
        string type,
        string? detail,
        string? code = null,
        IDictionary<string, object?>? errors = null)
    {
        var problem = new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Type = type,
            Detail = detail,
            Instance = context.Request.Path.Value
        };

        var correlationId = ResolveCorrelationId(context);
        if (!string.IsNullOrEmpty(correlationId))
        {
            problem.Extensions["correlationId"] = correlationId;
        }

        var traceId = Activity.Current?.Id;
        if (!string.IsNullOrEmpty(traceId))
        {
            problem.Extensions["traceId"] = traceId;
        }

        if (!string.IsNullOrEmpty(code))
        {
            problem.Extensions["code"] = code;
        }

        if (errors is { Count: > 0 })
        {
            problem.Extensions["errors"] = errors;
        }

        context.Response.StatusCode = statusCode;
        context.Response.ContentType = ContentType;
        await context.Response.WriteAsJsonAsync(problem, JsonOptions, ContentType);
    }

    private static string? ResolveCorrelationId(HttpContext context)
    {
        if (context.Items.TryGetValue("RequestContext", out var raw)
            && raw is not null)
        {
            var type = raw.GetType();
            var prop = type.GetProperty("CorrelationId");
            if (prop?.GetValue(raw) is string s && !string.IsNullOrEmpty(s))
            {
                return s;
            }
        }

        return Activity.Current?.Id;
    }
}
