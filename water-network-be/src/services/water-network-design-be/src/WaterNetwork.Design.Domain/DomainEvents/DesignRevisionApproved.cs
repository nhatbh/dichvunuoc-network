using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionApprovedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string? Reason);

public sealed record DesignRevisionApproved(string AggregateId, DesignRevisionApprovedData Data)
    : DomainEventBase<DesignRevisionApprovedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionApproved",
        data: Data);
