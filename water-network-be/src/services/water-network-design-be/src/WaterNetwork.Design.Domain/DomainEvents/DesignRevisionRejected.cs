using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionRejectedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string Reason);

public sealed record DesignRevisionRejected(string AggregateId, DesignRevisionRejectedData Data)
    : DomainEventBase<DesignRevisionRejectedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionRejected",
        data: Data);
