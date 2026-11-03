using WaterNetwork.Incident.Application.Dtos;

namespace WaterNetwork.Incident.Application.Ports;

public interface IIncidentReadDao
{
    Task<IncidentDetailDto?> GetDetailAsync(string tenantId, string incidentId, CancellationToken ct = default);
    Task<IReadOnlyList<IncidentSummaryDto>> ListAsync(
        string tenantId, string? status, int? severity, CancellationToken ct = default);
}
