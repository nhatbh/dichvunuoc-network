using System.Net;

namespace WaterNetwork.Bff.Api.Http;

public sealed class TenantAppEntitlementClient(HttpClient client) : ITenantAppEntitlementClient
{
    public async Task<TenantAppAccessStatus> CheckAccessAsync(
        string appCode,
        CancellationToken cancellationToken)
    {
        try
        {
            // Entitlement is independent of the catalog menu's administrative visibility.
            // Only the authenticated access endpoint can authorize downstream GIS requests.
            using var response = await client.GetAsync(
                $"api/platform/app-catalog/me/apps/{Uri.EscapeDataString(appCode)}/access",
                cancellationToken);

            return response.StatusCode switch
            {
                HttpStatusCode.NoContent => TenantAppAccessStatus.Allowed,
                HttpStatusCode.Forbidden => TenantAppAccessStatus.Denied,
                _ => TenantAppAccessStatus.Unavailable,
            };
        }
        catch (HttpRequestException)
        {
            return TenantAppAccessStatus.Unavailable;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return TenantAppAccessStatus.Unavailable;
        }
    }
}
