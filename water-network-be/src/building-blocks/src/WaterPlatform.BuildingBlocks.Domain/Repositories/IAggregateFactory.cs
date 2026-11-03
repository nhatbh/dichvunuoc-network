using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterPlatform.BuildingBlocks.Domain.Repositories;

public interface IAggregateFactory<TAggregate> where TAggregate : AggregateRoot
{
    TAggregate Reconstitute(params object[] args);
}
