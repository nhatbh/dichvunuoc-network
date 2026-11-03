using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record PipeDeletedData(
    string TenantId,
    string AssetCode);

public sealed record PipeDeleted(
    string AggregateId,
    PipeDeletedData Data)
    : DomainEventBase<PipeDeletedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkPipe",
        eventType: "PipeDeleted",
        data: Data);
