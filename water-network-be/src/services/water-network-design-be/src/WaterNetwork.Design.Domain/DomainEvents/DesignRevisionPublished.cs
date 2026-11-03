using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionPublishedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string Status,
    int ImportedCount,
    int FailedCount);

public sealed record DesignRevisionPublished(string AggregateId, DesignRevisionPublishedData Data)
    : DomainEventBase<DesignRevisionPublishedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionPublished",
        data: Data);
