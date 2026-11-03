using System.Net.Http.Headers;
using Microsoft.AspNetCore.Http;

namespace WaterPlatform.BuildingBlocks.WebApi.Http;

/// <summary>
/// Propagates the authenticated caller and request correlation context to an HTTP
/// downstream service. A caller may pre-populate a tenant header from its trusted
/// tenant context; inbound headers only fill values that are not already present.
/// </summary>
public sealed class DownstreamRequestContextHandler(IHttpContextAccessor accessor) : DelegatingHandler
{
    private static readonly string[] ForwardedHeaders = ["X-Tenant-Id", "X-Correlation-Id"];

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var context = accessor.HttpContext;
        if (context is not null)
        {
            var authorization = context.Request.Headers.Authorization.ToString();
            if (request.Headers.Authorization is null
                && !string.IsNullOrWhiteSpace(authorization)
                && AuthenticationHeaderValue.TryParse(authorization, out var parsed))
            {
                request.Headers.Authorization = parsed;
            }

            foreach (var headerName in ForwardedHeaders)
            {
                if (request.Headers.Contains(headerName))
                    continue;

                var value = context.Request.Headers[headerName].ToString();
                if (!string.IsNullOrWhiteSpace(value))
                    request.Headers.TryAddWithoutValidation(headerName, value);
            }
        }

        return base.SendAsync(request, cancellationToken);
    }
}
