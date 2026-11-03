namespace WaterNetwork.Gis.Application.Dtos;

/// <summary>
/// Tenant-scoped bootstrap payload used to initialise the GIS map and summary widgets.
/// The schema version is intentionally explicit so clients can evolve independently.
/// </summary>
public sealed record AssetBootstrapDto(
    int SchemaVersion,
    bool HasData,
    AssetHomeViewDto? HomeView,
    AssetCountsDto Counts,
    double PipeLengthM,
    IReadOnlyList<MaterialMixItemDto> MaterialMix,
    IReadOnlyList<StatusMixItemDto> StatusMix);

public sealed record AssetHomeViewDto(
    IReadOnlyList<double> Bbox,
    AssetHomeViewCenterDto Center,
    string Source);

public sealed record AssetHomeViewCenterDto(double Lon, double Lat);

public sealed record AssetCountsDto(long Nodes, long Pipes, long Devices, long Total);

public sealed record MaterialMixItemDto(string Material, long Count, double LengthM);

public sealed record StatusMixItemDto(string Status, long Count);
