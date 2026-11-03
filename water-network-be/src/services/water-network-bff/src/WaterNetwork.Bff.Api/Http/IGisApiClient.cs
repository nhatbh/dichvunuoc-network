using System.Text.Json.Nodes;

namespace WaterNetwork.Bff.Api.Http;

public interface IGisApiClient
{
    /// <summary>
    /// Fetches a single asset detail. <paramref name="type"/> must be one of node|pipe|device;
    /// an unknown value throws <see cref="ArgumentOutOfRangeException"/> (caller maps to 400),
    /// distinct from the tri-state result which only models downstream outcomes.
    /// </summary>
    Task<DownstreamResult<JsonNode>> GetDetailAsync(string type, string id, CancellationToken ct);
    Task<MapPassthrough> GetMapAsync(string? bbox, string? types, int? limit, CancellationToken ct);
    Task<MapPassthrough> GetBootstrapAsync(CancellationToken ct);
}
