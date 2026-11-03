using WaterNetwork.Incident.Domain.Aggregates;

namespace WaterNetwork.Incident.Domain.Repositories;

public interface INetworkIncidentRepository
{
    Task<NetworkIncident> SaveAsync(NetworkIncident incident, CancellationToken ct = default);
    Task<NetworkIncident?> GetByIdAsync(string id, CancellationToken ct = default);
}
