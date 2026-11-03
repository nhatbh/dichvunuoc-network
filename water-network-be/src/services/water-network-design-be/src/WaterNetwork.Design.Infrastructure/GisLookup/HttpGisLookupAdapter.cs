using System.Net.Http.Json;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Gis.Contracts.Responses;

namespace WaterNetwork.Design.Infrastructure.GisLookup;

/// <summary>Tenant-scoped HTTP lookup against the canonical GIS service.</summary>
public sealed class HttpGisLookupAdapter(HttpClient httpClient) : IGisLookupPort
{
    public async Task<WaterNetwork.Design.Contracts.Events.NetworkEditInspectionV1> InspectEdits(
        string tenantId, IReadOnlyList<WaterNetwork.Design.Contracts.Events.NetworkEditOperationV1> operations, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/network/edit-inspection") { Content = JsonContent.Create(operations) };
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantId);
        using var response = await httpClient.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<WaterNetwork.Design.Contracts.Events.NetworkEditInspectionV1>(ct)
            ?? throw new InvalidDataException("GIS returned no edit inspection.");
    }

    public async Task<bool> AssetCodeExists(
        string tenantId,
        string assetCode,
        CancellationToken ct = default)
    {
        var path = $"/api/network/assets/exists?assetCode={Uri.EscapeDataString(assetCode)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantId);

        using var response = await httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            ct);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<AssetCodeExistsResponse>(ct);
        return payload?.Exists
            ?? throw new InvalidDataException("GIS asset existence response did not contain a payload.");
    }
}
