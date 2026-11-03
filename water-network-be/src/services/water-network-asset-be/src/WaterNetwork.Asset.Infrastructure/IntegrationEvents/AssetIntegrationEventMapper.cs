using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Asset.Infrastructure.IntegrationEvents;

public sealed record AssetRegisteredIntegrationEvent(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string SourceAggregateId,
    string SourceAggregateType,
    AssetRegisteredV1 Data)
    : IIntegrationEvent<AssetRegisteredV1>;

public sealed record AssetStatusChangedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, AssetStatusChangedV1 Data)
    : IIntegrationEvent<AssetStatusChangedV1>;

public sealed record AssetDecommissionedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, AssetDecommissionedV1 Data)
    : IIntegrationEvent<AssetDecommissionedV1>;

public sealed record AssetTechnicalProfileUpdatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, AssetTechnicalProfileUpdatedV1 Data)
    : IIntegrationEvent<AssetTechnicalProfileUpdatedV1>;

public sealed class AssetIntegrationEventMapper : IIntegrationEventMapper
{
    private static readonly Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry =
        new(StringComparer.Ordinal)
        {
            ["AssetRegistered"] = e => e is AssetRegistered a ? MapAssetRegistered(a) : null,
            ["AssetStatusChanged"] = e => e is AssetStatusChanged x ? MapStatusChanged(x) : null,
            ["AssetDecommissioned"] = e => e is AssetDecommissioned x ? MapDecommissioned(x) : null,
            ["AssetTechnicalProfileUpdated"] = e => e is AssetTechnicalProfileUpdated x ? MapTechProfile(x) : null,
        };

    public bool CanMap(string eventType) => Registry.ContainsKey(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
        => Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null;

    private static AssetRegisteredIntegrationEvent MapAssetRegistered(AssetRegistered e)
        => new(
            EventId: e.EventId,
            EventType: AssetEventTypes.AssetRegistered,
            EventVersion: 1,
            OccurredAt: e.OccurredAt,
            SourceAggregateId: e.AggregateId,
            SourceAggregateType: e.AggregateType,
            Data: new AssetRegisteredV1(e.AggregateId, e.Data.TenantId, e.Data.AssetType, e.Data.AssetCode, e.Data.Status));

    private static AssetStatusChangedIntegrationEvent MapStatusChanged(AssetStatusChanged e)
        => new(e.EventId, AssetEventTypes.StatusChanged, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new AssetStatusChangedV1(e.AggregateId, e.Data.AssetType, e.Data.PreviousStatus, e.Data.NewStatus, e.Data.Reason, e.Data.ChangedBy));

    private static AssetDecommissionedIntegrationEvent MapDecommissioned(AssetDecommissioned e)
        => new(e.EventId, AssetEventTypes.Decommissioned, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new AssetDecommissionedV1(e.AggregateId, e.Data.AssetType, e.Data.Reason, e.Data.DecommissionedBy));

    private static AssetTechnicalProfileUpdatedIntegrationEvent MapTechProfile(AssetTechnicalProfileUpdated e)
        => new(e.EventId, AssetEventTypes.TechnicalProfileUpdated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new AssetTechnicalProfileUpdatedV1(e.AggregateId, e.Data.AssetType, e.Data.InstallationYear, e.Data.Manufacturer, e.Data.Model));
}
