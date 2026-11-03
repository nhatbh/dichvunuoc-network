using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record PipeRegisteredData(
    string TenantId,
    string AssetCode,
    string FromNodeId,
    string ToNodeId,
    IReadOnlyList<GeoPoint> Points,
    double DiameterMm,
    string Material,
    double LengthM);

public sealed record PipeRegistered(
    string AggregateId,
    PipeRegisteredData Data)
    : DomainEventBase<PipeRegisteredData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkPipe",
        eventType: "PipeRegistered",
        data: Data);
