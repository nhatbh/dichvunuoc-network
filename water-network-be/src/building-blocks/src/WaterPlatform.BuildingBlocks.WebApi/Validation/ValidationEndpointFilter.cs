using FluentValidation;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.WebApi.Http;

namespace WaterPlatform.BuildingBlocks.WebApi.Validation;

/// <summary>
/// Minimal-API filter that runs FluentValidation against a typed request and
/// returns a unified <c>application/problem+json</c> ProblemDetails response
/// on failure (same shape as <see cref="GlobalExceptionMiddleware"/> — US-X-02).
/// </summary>
public sealed class ValidationEndpointFilter<TRequest> : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.Arguments.OfType<TRequest>().FirstOrDefault();
        if (request is not null)
        {
            var validator = context.HttpContext.RequestServices.GetService<IValidator<TRequest>>();
            if (validator is not null)
            {
                var result = await validator.ValidateAsync(request, context.HttpContext.RequestAborted);
                if (!result.IsValid)
                {
                    // FluentValidation's ToDictionary returns Dictionary<string, string[]>;
                    // wrap it in a Dictionary<string, object?> so the
                    // ProblemDetailsWriter can serialize it uniformly.
                    var errors = result.ToDictionary()
                        .ToDictionary(
                            kv => kv.Key,
                            kv => (object?)kv.Value);

                    await ProblemDetailsWriter.WriteAsync(
                        context.HttpContext,
                        statusCode: 400,
                        title: "Validation failed",
                        type: "https://docs.water-platform/errors/400",
                        detail: "One or more validation errors occurred.",
                        code: "VALIDATION_FAILED",
                        errors: errors);

                    return Results.Empty;
                }
            }
        }

        return await next(context);
    }
}

public static class ValidationEndpointFilterExtensions
{
    public static RouteHandlerBuilder WithValidation<TRequest>(this RouteHandlerBuilder builder)
        => builder.AddEndpointFilter<ValidationEndpointFilter<TRequest>>();
}
