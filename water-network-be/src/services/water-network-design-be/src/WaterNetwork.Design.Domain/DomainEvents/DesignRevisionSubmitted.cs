using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionSubmittedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId);

public sealed record DesignRevisionSubmitted(string AggregateId, DesignRevisionSubmittedData Data)
    : DomainEventBase<DesignRevisionSubmittedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionSubmitted",
        data: Data);
