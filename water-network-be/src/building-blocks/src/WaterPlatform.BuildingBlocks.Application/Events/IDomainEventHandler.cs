using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterPlatform.BuildingBlocks.Application.Events;

public interface IDomainEventHandler<in TEvent> where TEvent : IDomainEvent
{
    Task HandleAsync(TEvent domainEvent, CancellationToken ct);
}
