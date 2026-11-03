using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

public interface IIntegrationEventMapper
{
    IIntegrationEvent? Map(IDomainEvent domainEvent);
    bool CanMap(string eventType);
}
