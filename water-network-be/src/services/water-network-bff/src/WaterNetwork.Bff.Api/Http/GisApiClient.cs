using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using Polly.CircuitBreaker;
using Polly.Timeout;

namespace WaterNetwork.Bff.Api.Http;

public sealed class GisApiClient(HttpClient http) : IGisApiClient
{
    public async Task<DownstreamResult<JsonNode>> GetDetailAsync(string type, string id, CancellationToken ct)
    {
        var path = type switch
        {
            "node" => $"/api/network/nodes/{Uri.EscapeDataString(id)}",
            "pipe" => $"/api/network/pipes/{Uri.EscapeDataString(id)}",
            "device" => $"/api/network/devices/{Uri.EscapeDataString(id)}",
            _ => throw new ArgumentOutOfRangeException(nameof(type), type, "type must be node|pipe|device")
        };

        try
        {
            using var resp = await http.GetAsync(path, ct);
            if (resp.StatusCode == HttpStatusCode.NotFound)
                return DownstreamResult<JsonNode>.NotFound;
            if (!resp.IsSuccessStatusCode)
                return DownstreamResult<JsonNode>.Unavailable;

            var body = await resp.Content.ReadFromJsonAsync<JsonNode>(ct);
            return body is null ? DownstreamResult<JsonNode>.Unavailable : DownstreamResult<JsonNode>.Ok(body);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException
            or TimeoutRejectedException or BrokenCircuitException)
        {
            return DownstreamResult<JsonNode>.Unavailable;
        }
    }

    public async Task<MapPassthrough> GetMapAsync(string? bbox, string? types, int? limit, CancellationToken ct)
    {
        var query = new Dictionary<string, string?>();
        if (!string.IsNullOrWhiteSpace(bbox)) query["bbox"] = bbox;
        if (!string.IsNullOrWhiteSpace(types)) query["types"] = types;
        if (limit is not null) query["limit"] = limit.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var path = QueryHelpers.AddQueryString("/api/network/assets", query);

        return await GetPassthroughAsync(path, ct);
    }

    public Task<MapPassthrough> GetBootstrapAsync(CancellationToken ct) =>
        GetPassthroughAsync("/api/network/assets/bootstrap", ct);

    private async Task<MapPassthrough> GetPassthroughAsync(string path, CancellationToken ct)
    {
        try
        {
            using var resp = await http.GetAsync(path, ct);
            if ((int)resp.StatusCode >= 500)
                return new MapPassthrough(Unavailable: true, 0, null);

            var body = await resp.Content.ReadFromJsonAsync<JsonNode>(ct);
            return body is null
                ? new MapPassthrough(Unavailable: true, 0, null)
                : new MapPassthrough(Unavailable: false, (int)resp.StatusCode, body);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException
            or TimeoutRejectedException or BrokenCircuitException or JsonException or NotSupportedException)
        {
            return new MapPassthrough(Unavailable: true, 0, null);
        }
    }
}
