using System.Text.Json;
using MassTransit;
using Microsoft.Extensions.Options;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterPlatform.BuildingBlocks.EventBus;

/// <summary>
/// Publishes an <see cref="IIntegrationEvent"/> by wrapping it in an <see cref="IntegrationEventEnvelope"/>
/// and dispatching through MassTransit.
/// </summary>
/// <remarks>
/// <b>Tenant resolution (outbox-published events):</b> the <c>tenantId</c> parameter wins over
/// the ambient <see cref="ITenantContextAccessor.Current"/> for <c>envelope.TenantId</c>.
/// The <c>OutboxProcessor</c> passes <c>entry.TenantId</c> (stamped at write-time by Task A1)
/// so that background-scope publishes carry the correct tenant even with no ambient context.
/// <c>OrganizationId</c> and <c>BranchId</c> still come from the ambient context (they are not
/// stored on the outbox entry in this iteration).
///
/// <b>CausationId:</b> <c>null</c> until command-id propagation is implemented. Do NOT use
/// <c>SourceAggregateId</c> here — that is the aggregate identity, not a causation id.
/// </remarks>
internal sealed class MassTransitIntegrationEventPublisher(
    IPublishEndpoint publishEndpoint,
    ITenantContextAccessor tenantAccessor,
    IOptions<EventBusOptions> options) : IIntegrationEventPublisher
{
    public async Task PublishAsync(IIntegrationEvent integrationEvent, string? tenantId = null, CancellationToken ct = default)
    {
        var tenant = tenantAccessor.Current;
        var envelope = new IntegrationEventEnvelope(
            EventId: integrationEvent.EventId,
            EventType: integrationEvent.EventType,
            EventVersion: integrationEvent.EventVersion,
            OccurredAt: integrationEvent.OccurredAt,
            // Explicit tenantId wins; ambient is the fallback (e.g. for direct/non-outbox publishes).
            TenantId: tenantId ?? tenant?.TenantId,
            OrganizationId: tenant?.OrganizationId,
            BranchId: tenant?.BranchId,
            // Full W3C trace id when available; fall back to TraceId hex if the Activity id is null.
            CorrelationId: System.Diagnostics.Activity.Current?.Id
                           ?? System.Diagnostics.Activity.Current?.TraceId.ToString(),
            // TODO: populate once command-id propagation is implemented.
            CausationId: null,
            Producer: options.Value.Producer,
            Payload: JsonSerializer.Serialize(integrationEvent, integrationEvent.GetType()));

        await publishEndpoint.Publish(envelope, ct);
    }
}
