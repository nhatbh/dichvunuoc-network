using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionValidatedData(
    string ProjectId,
    string TenantId,
    int ErrorCount,
    int WarningCount,
    bool IsValid);

public sealed record DesignRevisionValidated(string AggregateId, DesignRevisionValidatedData Data)
    : DomainEventBase<DesignRevisionValidatedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionValidated",
        data: Data);
