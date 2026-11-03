using WaterPlatform.BuildingBlocks.Domain.Events;
namespace WaterNetwork.Design.Domain.DomainEvents;
public sealed record DesignRevisionDraftsChangedData(string ProjectId, string TenantId);
public sealed record DesignRevisionDraftsChanged(string AggregateId, DesignRevisionDraftsChangedData Data)
    : DomainEventBase<DesignRevisionDraftsChangedData>(AggregateId, "DesignRevision", "DesignRevisionDraftsChanged", Data);
