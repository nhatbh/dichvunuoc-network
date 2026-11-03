using WaterNetwork.Gis.Domain.Aggregates;
namespace WaterNetwork.Gis.Domain.Repositories;

public interface IGisImportBatchRepository
{
    Task SaveAsync(GisImportBatch batch, CancellationToken ct = default);
}
