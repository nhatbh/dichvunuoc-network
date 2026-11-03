// IGisLookupPort.cs
namespace WaterNetwork.Design.Application.Ports;

/// <summary>Read-only lookup into the GIS service used during draft validation.</summary>
public interface IGisLookupPort
{
    Task<WaterNetwork.Design.Contracts.Events.NetworkEditInspectionV1> InspectEdits(string tenantId, IReadOnlyList<WaterNetwork.Design.Contracts.Events.NetworkEditOperationV1> operations, CancellationToken ct = default)
        => throw new NotSupportedException("Network editing requires the canonical GIS provider.");

    Task<bool> AssetCodeExists(string tenantId, string assetCode, CancellationToken ct = default);
}
