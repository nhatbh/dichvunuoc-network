using WaterNetwork.Gis.Application.Dtos;

namespace WaterNetwork.Gis.Application.Ports;

public interface INodeReadDao
{
    Task<NodeDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
}
