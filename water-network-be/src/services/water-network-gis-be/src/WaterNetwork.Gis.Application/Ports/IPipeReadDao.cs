using WaterNetwork.Gis.Application.Dtos;

namespace WaterNetwork.Gis.Application.Ports;

public interface IPipeReadDao
{
    Task<PipeDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
}
