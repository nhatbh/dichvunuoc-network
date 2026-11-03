using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Polly.CircuitBreaker;
using Polly.Timeout;

namespace WaterNetwork.Bff.Api.Http;

/// <summary>BFF-local projection of asset-be's profile — only the fields the overview surfaces.</summary>
public sealed record AssetProfile(string Id, string AssetCode, string Status, JsonNode? TechnicalProfile);

public sealed class AssetApiClient(HttpClient http) : IAssetApiClient
{
    public async Task<DownstreamResult<AssetProfile>> GetProfileAsync(string id, CancellationToken ct)
    {
        try
        {
            using var resp = await http.GetAsync($"/api/assets/{id}", ct);
            if (resp.StatusCode == HttpStatusCode.NotFound)
                return DownstreamResult<AssetProfile>.NotFound;
            if (!resp.IsSuccessStatusCode)
                return DownstreamResult<AssetProfile>.Unavailable;

            var profile = await resp.Content.ReadFromJsonAsync<AssetProfile>(ct);
            return profile is null
                ? DownstreamResult<AssetProfile>.Unavailable
                : DownstreamResult<AssetProfile>.Ok(profile);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException
            or TimeoutRejectedException or BrokenCircuitException)
        {
            return DownstreamResult<AssetProfile>.Unavailable;
        }
    }
}
