using System.Net.Http.Headers;
using Microsoft.AspNetCore.Http;
using WaterPlatform.BuildingBlocks.Application.Context;

namespace WaterNetwork.Bff.Api.Http;

/// <summary>
/// Copies the inbound caller's auth + tenant + correlation context onto outbound downstream
/// requests. BFF never mints tokens — it forwards the bearer it received (JWT passthrough).
/// </summary>
public sealed class AuthForwardingHandler(IHttpContextAccessor accessor) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var ctx = accessor.HttpContext;
        if (ctx is not null)
        {
            var auth = ctx.Request.Headers.Authorization.ToString();
            if (!string.IsNullOrWhiteSpace(auth) && AuthenticationHeaderValue.TryParse(auth, out var parsed))
                request.Headers.Authorization = parsed;

            ForwardIfMissing(request, "X-Tenant-Id", ctx.Request.Headers["X-Tenant-Id"].ToString());

            var correlationId = ctx.Request.Headers["X-Correlation-Id"].ToString();
            if (string.IsNullOrWhiteSpace(correlationId)
                && ctx.Items.TryGetValue("RequestContext", out var item)
                && item is RequestContext requestContext)
            {
                correlationId = requestContext.CorrelationId;
            }
            ForwardIfMissing(request, "X-Correlation-Id", correlationId);
        }

        return base.SendAsync(request, cancellationToken);
    }

    private static void ForwardIfMissing(HttpRequestMessage request, string name, string? value)
    {
        if (request.Headers.Contains(name) || string.IsNullOrWhiteSpace(value))
            return;

        request.Headers.TryAddWithoutValidation(name, value);
    }
}
