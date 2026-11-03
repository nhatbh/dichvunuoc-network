using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignProjectCreatedData(
    string TenantId,
    string Name,
    string? BranchId,
    string? ZoneId);

public sealed record DesignProjectCreated(string AggregateId, DesignProjectCreatedData Data)
    : DomainEventBase<DesignProjectCreatedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignProject",
        eventType: "DesignProjectCreated",
        data: Data);
