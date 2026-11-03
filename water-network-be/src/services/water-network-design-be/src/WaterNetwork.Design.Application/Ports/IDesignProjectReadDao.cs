using WaterNetwork.Design.Application.Dtos;

namespace WaterNetwork.Design.Application.Ports;

public interface IDesignProjectReadDao
{
    Task<DesignProjectDetailDto?> GetDetailAsync(string tenantId, string projectId, CancellationToken ct = default);
    Task<bool> ExistsAsync(string tenantId, string projectId, CancellationToken ct = default);
}
