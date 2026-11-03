using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Application.Ports;

/// <summary>Read-only check that an affected asset reference exists in GIS.</summary>
public interface IGisLookupPort
{
    Task<bool> AssetRefExists(string tenantId, AssetRefKind kind, string assetId, CancellationToken ct = default);
}
