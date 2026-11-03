using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionCreatedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber);

public sealed record DesignRevisionCreated(string AggregateId, DesignRevisionCreatedData Data)
    : DomainEventBase<DesignRevisionCreatedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionCreated",
        data: Data);
