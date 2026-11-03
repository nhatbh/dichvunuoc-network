using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignAssetReadyForGisData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ApprovedBy,
    IReadOnlyList<DraftAssetSnapshot> Assets);

public sealed record DesignAssetReadyForGis(string AggregateId, DesignAssetReadyForGisData Data)
    : DomainEventBase<DesignAssetReadyForGisData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignAssetReadyForGis",
        data: Data);
