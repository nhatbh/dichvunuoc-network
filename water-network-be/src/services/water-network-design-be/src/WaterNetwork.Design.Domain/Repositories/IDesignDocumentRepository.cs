using WaterNetwork.Design.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Design.Domain.Repositories;

public interface IDesignDocumentRepository : IAggregateRepository<DesignDocument>;
