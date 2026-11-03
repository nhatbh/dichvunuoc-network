using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Gis.Infrastructure.IntegrationEvents;

public sealed record NodeRegisteredIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkNodeRegisteredV1 Data)
    : IIntegrationEvent<NetworkNodeRegisteredV1>;

public sealed record PipeRegisteredIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkPipeRegisteredV1 Data)
    : IIntegrationEvent<NetworkPipeRegisteredV1>;

public sealed record DeviceInstalledIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkDeviceInstalledV1 Data)
    : IIntegrationEvent<NetworkDeviceInstalledV1>;

public sealed record NodeDeletedIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkNodeDeletedV1 Data)
    : IIntegrationEvent<NetworkNodeDeletedV1>;

public sealed record PipeDeletedIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkPipeDeletedV1 Data)
    : IIntegrationEvent<NetworkPipeDeletedV1>;

public sealed record DeviceDeletedIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkDeviceDeletedV1 Data)
    : IIntegrationEvent<NetworkDeviceDeletedV1>;

public sealed record NodeRelocatedIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkNodeRelocatedV1 Data)
    : IIntegrationEvent<NetworkNodeRelocatedV1>;

public sealed record NetworkGisImportCompletedIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    NetworkGisImportCompletedV1 Data)
    : IIntegrationEvent<NetworkGisImportCompletedV1>;

public sealed record NetworkAssetEditedIntegrationEvent(string EventId,string EventType,int EventVersion,DateTime OccurredAt,
    string SourceAggregateId,string SourceAggregateType,NetworkAssetEditedData Data) : IIntegrationEvent<NetworkAssetEditedData>;

public sealed class GisIntegrationEventMapper : IIntegrationEventMapper
{
    // Registry replaces the if-chain now that a 3rd event exists (template-mapping §7.3).
    // Key = domain event type name (the eventType string carried by DomainEventBase).
    // Each lambda's `: null` branch is the soft-failure path for a spoofed/mismatched EventType
    // string; for a well-formed domain event the type-guard always succeeds because the registry
    // key IS the event's own EventType.
    private static readonly Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry =
        new Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>>(StringComparer.Ordinal)
        {
            ["NetworkAssetEdited"] = e => e is NetworkAssetEdited x ? new NetworkAssetEditedIntegrationEvent(
                x.EventId,"network.asset.edited",1,x.OccurredAt,x.AggregateId,x.AggregateType,x.Data) : null,
            ["NodeRegistered"] = e => e is NodeRegistered n ? MapNodeRegistered(n) : null,
            ["PipeRegistered"] = e => e is PipeRegistered p ? MapPipeRegistered(p) : null,
            ["DeviceInstalled"] = e => e is DeviceInstalled d ? MapDeviceInstalled(d) : null,
            ["NodeDeleted"] = e => e is NodeDeleted x ? MapNodeDeleted(x) : null,
            ["PipeDeleted"] = e => e is PipeDeleted x ? MapPipeDeleted(x) : null,
            ["DeviceDeleted"] = e => e is DeviceDeleted x ? MapDeviceDeleted(x) : null,
            ["NodeRelocated"] = e => e is NodeRelocated x ? MapNodeRelocated(x) : null,
            ["NetworkGisImportCompleted"] = e => e is NetworkGisImportCompleted x ? MapImportCompleted(x) : null,
        };

    public bool CanMap(string eventType) => Registry.ContainsKey(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
        => Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null;

    private static NodeRegisteredIntegrationEvent MapNodeRegistered(NodeRegistered domainEvent)
    {
        var d = domainEvent.Data;
        var data = new NetworkNodeRegisteredV1(
            domainEvent.AggregateId,
            d.TenantId,
            d.AssetCode,
            d.NodeType,
            d.Latitude,
            d.Longitude);

        return new NodeRegisteredIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: GisEventTypes.NodeRegistered,
            EventVersion: 1,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: data);
    }

    private static PipeRegisteredIntegrationEvent MapPipeRegistered(PipeRegistered domainEvent)
    {
        var d = domainEvent.Data;
        // DiameterMm: domain is double (VO wraps double); contract is int (catalog reality).
        // Convert.ToInt32 mirrors the persistence layer conversion in NetworkPipeRepository.
        var data = new NetworkPipeRegisteredV1(
            PipeId: domainEvent.AggregateId,
            TenantId: d.TenantId,
            AssetCode: d.AssetCode,
            FromNodeId: d.FromNodeId,
            ToNodeId: d.ToNodeId,
            LengthM: d.LengthM,
            DiameterMm: Convert.ToInt32(d.DiameterMm),
            Material: d.Material);

        return new PipeRegisteredIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: GisEventTypes.PipeRegistered,
            EventVersion: 1,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: data);
    }

    private static DeviceInstalledIntegrationEvent MapDeviceInstalled(DeviceInstalled domainEvent)
    {
        var d = domainEvent.Data;
        var data = new NetworkDeviceInstalledV1(
            DeviceId: domainEvent.AggregateId,
            TenantId: d.TenantId,
            AssetCode: d.AssetCode,
            DeviceType: d.DeviceType,
            HostPipeId: d.HostPipeId,
            HostNodeId: d.HostNodeId,
            Latitude: d.Latitude,
            Longitude: d.Longitude);

        return new DeviceInstalledIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: GisEventTypes.DeviceInstalled,
            EventVersion: 1,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: data);
    }

    private static NodeDeletedIntegrationEvent MapNodeDeleted(NodeDeleted domainEvent)
    {
        var d = domainEvent.Data;
        var data = new NetworkNodeDeletedV1(
            NodeId: domainEvent.AggregateId,
            TenantId: d.TenantId,
            AssetCode: d.AssetCode,
            NodeType: d.NodeType);

        return new NodeDeletedIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: GisEventTypes.NodeDeleted,
            EventVersion: 1,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: data);
    }

    private static PipeDeletedIntegrationEvent MapPipeDeleted(PipeDeleted domainEvent)
    {
        var d = domainEvent.Data;
        var data = new NetworkPipeDeletedV1(
            PipeId: domainEvent.AggregateId,
            TenantId: d.TenantId,
            AssetCode: d.AssetCode);

        return new PipeDeletedIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: GisEventTypes.PipeDeleted,
            EventVersion: 1,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: data);
    }

    private static DeviceDeletedIntegrationEvent MapDeviceDeleted(DeviceDeleted domainEvent)
    {
        var d = domainEvent.Data;
        var data = new NetworkDeviceDeletedV1(
            DeviceId: domainEvent.AggregateId,
            TenantId: d.TenantId,
            AssetCode: d.AssetCode,
            DeviceType: d.DeviceType);

        return new DeviceDeletedIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: GisEventTypes.DeviceDeleted,
            EventVersion: 1,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: data);
    }

    private static NodeRelocatedIntegrationEvent MapNodeRelocated(NodeRelocated domainEvent)
    {
        var d = domainEvent.Data;
        var data = new NetworkNodeRelocatedV1(
            NodeId: domainEvent.AggregateId,
            TenantId: d.TenantId,
            AssetCode: d.AssetCode,
            OldLatitude: d.OldLatitude,
            OldLongitude: d.OldLongitude,
            NewLatitude: d.NewLatitude,
            NewLongitude: d.NewLongitude,
            Reason: d.Reason);

        return new NodeRelocatedIntegrationEvent(
            EventId: domainEvent.EventId,
            EventType: GisEventTypes.NodeRelocated,
            EventVersion: 1,
            OccurredAt: domainEvent.OccurredAt,
            SourceAggregateId: domainEvent.AggregateId,
            SourceAggregateType: domainEvent.AggregateType,
            Data: data);
    }

    private static NetworkGisImportCompletedIntegrationEvent MapImportCompleted(NetworkGisImportCompleted e)
        => new(
            EventId: e.EventId,
            EventType: GisEventTypes.GisImportCompleted,
            EventVersion: 1,
            OccurredAt: e.OccurredAt,
            SourceAggregateId: e.AggregateId,
            SourceAggregateType: e.AggregateType,
            Data: new NetworkGisImportCompletedV1(
                RevisionId: e.Data.RevisionId,
                TenantId: e.Data.TenantId,
                Imported: e.Data.Imported
                    .Select(i => new GisImportedAssetV1(i.DraftAssetId, i.GisAssetId, i.Kind, i.AssetCode))
                    .ToList(),
                Failed: e.Data.Failed
                    .Select(f => new GisImportFailureV1(f.DraftAssetId, f.AssetCode, f.Reason))
                    .ToList()));
}
