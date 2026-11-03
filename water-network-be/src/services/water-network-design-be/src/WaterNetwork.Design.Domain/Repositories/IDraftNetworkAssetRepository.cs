using WaterNetwork.Design.Domain.Entities;

namespace WaterNetwork.Design.Domain.Repositories;

public interface IDraftNetworkAssetRepository
{
    Task AddAsync(DraftNetworkAsset draft, CancellationToken ct = default);
    Task AddRangeAsync(IReadOnlyList<DraftNetworkAsset> drafts, CancellationToken ct = default);
    Task<DraftNetworkAsset?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
    Task<IReadOnlyList<DraftNetworkAsset>> ListByRevisionAsync(string tenantId, string revisionId, CancellationToken ct = default);
    Task UpdateAsync(DraftNetworkAsset draft, CancellationToken ct = default);
}
