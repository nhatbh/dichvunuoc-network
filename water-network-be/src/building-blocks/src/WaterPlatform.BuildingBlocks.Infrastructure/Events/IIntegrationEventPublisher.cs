namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

public interface IIntegrationEventPublisher
{
    /// <param name="integrationEvent">The integration event to publish.</param>
    /// <param name="tenantId">
    /// Explicit tenant override. When non-null this wins over ambient context for
    /// <c>envelope.TenantId</c>. Pass the stored <c>OutboxEntry.TenantId</c> here when
    /// draining the outbox so background-scope events carry the correct tenant.
    /// </param>
    /// <param name="ct">Cancellation token.</param>
    Task PublishAsync(IIntegrationEvent integrationEvent, string? tenantId = null, CancellationToken ct = default);
}
