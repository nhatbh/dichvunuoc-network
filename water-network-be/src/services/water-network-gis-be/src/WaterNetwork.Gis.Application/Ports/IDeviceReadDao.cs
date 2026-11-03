using WaterNetwork.Gis.Application.Dtos;

namespace WaterNetwork.Gis.Application.Ports;

public interface IDeviceReadDao
{
    Task<DeviceDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
}
