using System.Text.Json.Nodes;

namespace WaterNetwork.Bff.Api.Contracts;

public sealed record OverviewResponse(
    string AssetId,
    string Type,
    JsonNode? Gis,
    LifecycleDto? Lifecycle,
    SourcesDto Sources);

public sealed record LifecycleDto(string Status, string AssetCode, JsonNode? TechnicalProfile);

public sealed record SourcesDto(string Gis, string Asset);
