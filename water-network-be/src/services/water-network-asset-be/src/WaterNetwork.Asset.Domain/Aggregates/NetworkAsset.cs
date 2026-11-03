using WaterNetwork.Asset.Domain.DomainEvents;
using WaterNetwork.Asset.Domain.Entities;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Asset.Domain.Aggregates;

public sealed class NetworkAsset : AggregateRoot
{
    private readonly List<AssetLifecycleEntry> _lifecycleEntries = [];

    public string TenantId { get; private set; }
    public AssetType AssetType { get; private set; }
    public string AssetCode { get; private set; }
    public AssetStatus Status { get; private set; }
    public IReadOnlyList<AssetLifecycleEntry> LifecycleEntries => _lifecycleEntries.AsReadOnly();
    public string? DecommissionReason { get; private set; }
    public string? DecommissionedBy { get; private set; }
    public AssetTechnicalProfile? TechnicalProfile { get; private set; }

    private NetworkAsset(
        string id, string tenantId, AssetType assetType, string assetCode, AssetStatus status,
        int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        AssetType = assetType;
        AssetCode = assetCode;
        Status = status;
    }

    /// <summary>
    /// Creates an asset profile from a GIS registration event. The id is the GIS asset id
    /// (shared key → natural idempotency). Default business status is Active (US-P1-05),
    /// recorded as a Registered→Active transition.
    /// </summary>
    public static NetworkAsset RegisterFromGis(string assetId, string tenantId, AssetType assetType, string assetCode)
    {
        var asset = new NetworkAsset(assetId, tenantId, assetType, assetCode, AssetStatus.Active);
        asset._lifecycleEntries.Add(new AssetLifecycleEntry(
            AssetStatus.Registered, AssetStatus.Active, actorId: "system", reason: "gis-registration", occurredAt: DateTime.UtcNow));
        asset.MarkAsModified();

        asset.AddDomainEvent(new AssetRegistered(asset.Id, new AssetRegisteredData(
            TenantId: tenantId,
            AssetType: assetType.ToString(),
            AssetCode: assetCode,
            Status: AssetStatus.Active.ToString())));
        return asset;
    }

    public static NetworkAsset Reconstitute(
        string id, string tenantId, AssetType assetType, string assetCode, AssetStatus status,
        int version, DateTime createdAt, DateTime updatedAt, IEnumerable<AssetLifecycleEntry> lifecycleEntries,
        string? decommissionReason = null, string? decommissionedBy = null,
        AssetTechnicalProfile? technicalProfile = null)
    {
        var asset = new NetworkAsset(id, tenantId, assetType, assetCode, status, version, createdAt, updatedAt);
        asset._lifecycleEntries.AddRange(lifecycleEntries);
        asset.DecommissionReason = decommissionReason;
        asset.DecommissionedBy = decommissionedBy;
        asset.TechnicalProfile = technicalProfile;
        return asset;
    }

    public void UpdateTechnicalProfile(string changedBy, int? installationYear, string? manufacturer,
        string? model, IReadOnlyDictionary<string, string?> attributes)
    {
        GuardNotDecommissioned();
        if (installationYear is < 1900 or > 2100)
            throw BusinessRuleException.Violation("InvalidInstallationYear",
                $"[InvalidInstallationYear] installationYear {installationYear} is out of the plausible range 1900–2100.");

        TechnicalProfile = new AssetTechnicalProfile(installationYear, manufacturer, model, attributes);
        MarkAsModified();
        AddDomainEvent(new AssetTechnicalProfileUpdated(Id, new AssetTechnicalProfileUpdatedData(
            AssetType.ToString(), installationYear, manufacturer, model)));
    }

    public void Activate(string changedBy, string? reason)
        => Transition(changedBy, reason, AssetStatus.Active, validFrom: [AssetStatus.Suspended, AssetStatus.UnderMaintenance]);

    public void MarkAsMaintenance(string changedBy, string? reason)
        => Transition(changedBy, reason, AssetStatus.UnderMaintenance, validFrom: [AssetStatus.Active]);

    public void Suspend(string changedBy, string? reason)
        => Transition(changedBy, reason, AssetStatus.Suspended, validFrom: [AssetStatus.Active]);

    public void Decommission(string changedBy, string? reason)
    {
        GuardNotDecommissioned();
        var previous = Status;
        ApplyStatus(previous, AssetStatus.Decommissioned, changedBy, reason);
        DecommissionReason = reason;
        DecommissionedBy = changedBy;
        MarkAsModified(); // 2nd version bump for the 2nd event (AssetDecommissioned)
        AddDomainEvent(new AssetDecommissioned(Id, new AssetDecommissionedData(
            AssetType: AssetType.ToString(), Reason: reason, DecommissionedBy: changedBy)));
    }

    private void Transition(string changedBy, string? reason, AssetStatus target, AssetStatus[] validFrom)
    {
        GuardNotDecommissioned();
        if (Array.IndexOf(validFrom, Status) < 0)
            throw BusinessRuleException.Violation("InvalidAssetTransition",
                $"[InvalidAssetTransition] Cannot move asset from {Status} to {target}.");
        ApplyStatus(Status, target, changedBy, reason);
    }

    private void ApplyStatus(AssetStatus from, AssetStatus to, string changedBy, string? reason)
    {
        Status = to;
        _lifecycleEntries.Add(new AssetLifecycleEntry(from, to, changedBy, reason, DateTime.UtcNow));
        MarkAsModified();
        AddDomainEvent(new AssetStatusChanged(Id, new AssetStatusChangedData(
            AssetType: AssetType.ToString(), PreviousStatus: from.ToString(), NewStatus: to.ToString(),
            Reason: reason, ChangedBy: changedBy)));
    }

    private void GuardNotDecommissioned()
    {
        if (Status == AssetStatus.Decommissioned)
            throw BusinessRuleException.Violation("AssetAlreadyDecommissioned",
                "[AssetAlreadyDecommissioned] Asset is decommissioned (terminal); no further lifecycle changes are allowed.");
    }
}
