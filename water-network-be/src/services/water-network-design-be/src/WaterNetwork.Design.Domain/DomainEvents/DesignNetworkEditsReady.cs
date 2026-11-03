using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterNetwork.Design.Domain.ValueObjects;
namespace WaterNetwork.Design.Domain.DomainEvents;
public sealed record DesignNetworkEditsReadyData(string TenantId, string ApprovedBy, IReadOnlyList<NetworkEditOperation> Operations);
public sealed record DesignNetworkEditsReady(string AggregateId, DesignNetworkEditsReadyData Data)
    : DomainEventBase<DesignNetworkEditsReadyData>(AggregateId, "DesignRevision", "DesignNetworkEditsReady", Data);
