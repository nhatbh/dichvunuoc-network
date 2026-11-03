using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Queries;

public sealed class GetRevisionPublishResultQueryHandler(
    IDesignImportResultStore store,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetRevisionPublishResultQuery, IReadOnlyList<ImportResultDto>>
{
    public async Task<IReadOnlyList<ImportResultDto>> HandleAsync(GetRevisionPublishResultQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        var rows = await store.ListAsync(tenant.TenantId, query.RevisionId, ct);
        return rows.Select(r => new ImportResultDto(r.DraftAssetId, r.GisAssetId, r.Status, r.Reason)).ToList();
    }
}
