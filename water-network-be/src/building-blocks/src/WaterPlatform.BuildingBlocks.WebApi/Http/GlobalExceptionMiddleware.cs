using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterPlatform.BuildingBlocks.WebApi.Http;

/// <summary>
/// Catches all unhandled exceptions and maps them to a unified
/// <see cref="Microsoft.AspNetCore.Mvc.ProblemDetails"/> response.
/// <remarks>
/// Implements user story US-X-02: unified error contract across all services.
/// Status codes and machine-readable codes follow RFC 7807; correlationId
/// and traceId are attached as ProblemDetails extensions for cross-service
/// correlation. The 500 path is sanitized: the original exception message
/// is never echoed to the client.
/// </remarks>
/// </summary>
public sealed partial class GlobalExceptionMiddleware(
    RequestDelegate continuation,
    ILogger<GlobalExceptionMiddleware> logger)
{
    [LoggerMessage(Level = LogLevel.Error, Message = "An unhandled exception occurred")]
    private static partial void LogUnhandledException(ILogger logger, Exception ex);

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await continuation(context);
        }
        catch (Exception ex)
        {
            await HandleExceptionAsync(context, ex);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        // Log full exception server-side. Only sanitized data goes to the client.
        LogUnhandledException(logger, exception);

        var (status, title, code, message) = MapException(exception);
        var type = $"https://docs.water-platform/errors/{status}";

        await ProblemDetailsWriter.WriteAsync(
            context,
            statusCode: status,
            title: title,
            type: type,
            detail: message,
            code: code);
    }

    private static (int Status, string Title, string? Code, string? Message) MapException(Exception exception)
    {
        return exception switch
        {
            BadHttpRequestException badRequest => (
                (int)HttpStatusCode.BadRequest,
                "Bad request",
                "BAD_REQUEST",
                badRequest.Message),

            NotFoundException notFound => (
                (int)HttpStatusCode.NotFound,
                "Resource not found",
                "NOT_FOUND",
                notFound.Message),

            ValidationException validation => (
                (int)HttpStatusCode.BadRequest,
                "Validation failed",
                "VALIDATION_FAILED",
                validation.Message),

            ConcurrencyException concurrency => (
                (int)HttpStatusCode.Conflict,
                "Concurrency conflict",
                "CONCURRENCY_CONFLICT",
                concurrency.Message),

            UnauthorizedException unauthorized => (
                (int)HttpStatusCode.Unauthorized,
                "Unauthorized",
                "UNAUTHORIZED",
                unauthorized.Message),

            ForbiddenException forbidden => (
                (int)HttpStatusCode.Forbidden,
                "Forbidden",
                "FORBIDDEN",
                forbidden.Message),

            ConflictException conflict => (
                (int)HttpStatusCode.Conflict,
                "Conflict",
                "CONFLICT",
                conflict.Message),

            BusinessRuleException businessRule => (
                (int)HttpStatusCode.UnprocessableEntity,
                "Business rule violation",
                "BUSINESS_RULE",
                businessRule.Message),

            DomainException domain => (
                (int)HttpStatusCode.BadRequest,
                "Domain rule violation",
                "DOMAIN_RULE",
                domain.Message),

            _ => (
                (int)HttpStatusCode.InternalServerError,
                "An unexpected error occurred.",
                null,
                null)
        };
    }
}
