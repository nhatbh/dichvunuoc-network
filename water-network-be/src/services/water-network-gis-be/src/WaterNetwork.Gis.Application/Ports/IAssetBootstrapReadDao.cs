namespace WaterNetwork.Gis.Application.Ports;

public interface IAssetBootstrapReadDao
{
    /// <summary>
    /// Reads the complete bootstrap aggregate for one tenant in one database round-trip.
    /// </summary>
    Task<AssetBootstrapSnapshot> QueryAsync(string tenantId, CancellationToken ct = default);
}

public sealed record AssetBootstrapSnapshot(
    long Nodes,
    long Pipes,
    long Devices,
    double PipeLengthM,
    double? MinLon,
    double? MinLat,
    double? MaxLon,
    double? MaxLat,
    IReadOnlyList<AssetMaterialMixRow> MaterialMix,
    IReadOnlyList<AssetStatusMixRow> StatusMix)
{
    public long Total => Nodes + Pipes + Devices;
}

public sealed record AssetMaterialMixRow(string Material, long Count, double LengthM);

public sealed record AssetStatusMixRow(string Status, long Count);
