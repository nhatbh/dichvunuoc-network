using WaterNetwork.Incident.Contracts;
using WaterNetwork.Incident.Contracts.Events;
using WaterNetwork.Incident.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Incident.Infrastructure.IntegrationEvents;

public sealed record IncidentReportedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentReportedV1 Data)
    : IIntegrationEvent<IncidentReportedV1>;

public sealed record IncidentClassifiedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentClassifiedV1 Data)
    : IIntegrationEvent<IncidentClassifiedV1>;

public sealed record IncidentCancelledIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentCancelledV1 Data)
    : IIntegrationEvent<IncidentCancelledV1>;

public sealed record IncidentIsolationPlanCreatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentIsolationPlanCreatedV1 Data)
    : IIntegrationEvent<IncidentIsolationPlanCreatedV1>;

public sealed record IncidentIsolationPlanConfirmedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentIsolationPlanConfirmedV1 Data)
    : IIntegrationEvent<IncidentIsolationPlanConfirmedV1>;

public sealed record WorkOrderRequestedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, WorkOrderRequestedV1 Data)
    : IIntegrationEvent<WorkOrderRequestedV1>;

public sealed record IncidentResolvedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentResolvedV1 Data)
    : IIntegrationEvent<IncidentResolvedV1>;

public sealed class IncidentIntegrationEventMapper : IIntegrationEventMapper
{
    private static readonly Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry =
        new(StringComparer.Ordinal)
        {
            ["IncidentReported"] = e => e is IncidentReported x ? MapReported(x) : null,
            ["IncidentClassified"] = e => e is IncidentClassified x ? MapClassified(x) : null,
            ["IncidentCancelled"] = e => e is IncidentCancelled x ? MapCancelled(x) : null,
            ["IncidentIsolationPlanCreated"] = e => e is IncidentIsolationPlanCreated x ? MapIsolationPlanCreated(x) : null,
            ["IncidentIsolationPlanConfirmed"] = e => e is IncidentIsolationPlanConfirmed x ? MapIsolationPlanConfirmed(x) : null,
            ["WorkOrderRequested"] = e => e is WorkOrderRequested x ? MapWorkOrderRequested(x) : null,
            ["IncidentResolved"] = e => e is IncidentResolved x ? MapResolved(x) : null,
        };

    public bool CanMap(string eventType) => Registry.ContainsKey(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
        => Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null;

    private static IncidentReportedIntegrationEvent MapReported(IncidentReported e)
        => new(e.EventId, IncidentEventTypes.Reported, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentReportedV1(e.AggregateId, e.Data.TenantId, e.Data.Category, e.Data.Severity,
                e.Data.Longitude, e.Data.Latitude,
                e.Data.AffectedRefs.Select(r => new AffectedAssetRefV1(r.AssetId, r.Kind, r.Verified)).ToList(),
                e.Data.ReportedBy));

    private static IncidentClassifiedIntegrationEvent MapClassified(IncidentClassified e)
        => new(e.EventId, IncidentEventTypes.Classified, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentClassifiedV1(e.AggregateId, e.Data.TenantId, e.Data.Category, e.Data.Severity,
                e.Data.ActorId, e.Data.Note));

    private static IncidentCancelledIntegrationEvent MapCancelled(IncidentCancelled e)
        => new(e.EventId, IncidentEventTypes.Cancelled, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentCancelledV1(e.AggregateId, e.Data.TenantId, e.Data.Reason, e.Data.ActorId));

    private static IncidentIsolationPlanCreatedIntegrationEvent MapIsolationPlanCreated(IncidentIsolationPlanCreated e)
        => new(e.EventId, IncidentEventTypes.IsolationPlanCreated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentIsolationPlanCreatedV1(e.AggregateId, e.Data.TenantId, e.Data.PlanId, e.Data.StartNodeId,
                e.Data.GraphVersion, e.Data.ValvesToClose, e.Data.IsolatedNodes, e.Data.IsolatedPipes, e.Data.ComputedBy));

    private static IncidentIsolationPlanConfirmedIntegrationEvent MapIsolationPlanConfirmed(IncidentIsolationPlanConfirmed e)
        => new(e.EventId, IncidentEventTypes.IsolationPlanConfirmed, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentIsolationPlanConfirmedV1(e.AggregateId, e.Data.TenantId, e.Data.PlanId, e.Data.GraphVersion,
                e.Data.ValvesToClose, e.Data.IsolatedNodes, e.Data.IsolatedPipes,
                e.Data.AffectedRefs.Select(r => new IncidentAssetRefV1(r.AssetId, r.Kind)).ToList(),
                e.Data.ConfirmedBy));

    private static WorkOrderRequestedIntegrationEvent MapWorkOrderRequested(WorkOrderRequested e)
        => new(e.EventId, IncidentEventTypes.WorkOrderRequested, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new WorkOrderRequestedV1(e.AggregateId,
                e.Data.AssetRefs.Select(r => new IncidentAssetRefV1(r.AssetId, r.Kind)).ToList(),
                e.Data.Summary, e.Data.Severity));

    private static IncidentResolvedIntegrationEvent MapResolved(IncidentResolved e)
        => new(e.EventId, IncidentEventTypes.Resolved, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentResolvedV1(e.AggregateId, e.Data.TenantId, e.Data.ResolvedBy, e.Data.ResolutionNote));
}
