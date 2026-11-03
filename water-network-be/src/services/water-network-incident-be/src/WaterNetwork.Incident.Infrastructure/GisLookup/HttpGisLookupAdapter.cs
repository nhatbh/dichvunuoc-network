using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Infrastructure.GisLookup;

/// <summary>Tenant-scoped HTTP lookup against the canonical GIS detail endpoints.</summary>
public sealed class HttpGisLookupAdapter(HttpClient httpClient) : IGisLookupPort
{
    public async Task<bool> AssetRefExists(
        string tenantId,
        AssetRefKind kind,
        string assetId,
        CancellationToken ct = default)
    {
        var collection = kind switch
        {
            AssetRefKind.Node => "nodes",
            AssetRefKind.Pipe => "pipes",
            AssetRefKind.Device => "devices",
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unsupported GIS asset kind.")
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/network/{collection}/{Uri.EscapeDataString(assetId)}");
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantId);

        using var response = await httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            ct);

        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            return false;

        response.EnsureSuccessStatusCode();
        return true;
    }
}
