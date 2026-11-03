using WaterNetwork.Design.Application.Dtos;

namespace WaterNetwork.Design.Application.Ports;

public interface IDesignRevisionReadDao
{
    Task<DesignRevisionDetailDto?> GetDetailAsync(string tenantId, string revisionId, CancellationToken ct = default);
    Task<bool> ExistsAsync(string tenantId, string revisionId, CancellationToken ct = default);
    Task<IReadOnlyList<DraftAssetPreviewDto>> ListPreviewAsync(string tenantId, string revisionId, CancellationToken ct = default);
    Task<IReadOnlyList<RevisionTransitionDto>> ListTransitionsAsync(
        string tenantId, string revisionId, CancellationToken ct = default);
}
