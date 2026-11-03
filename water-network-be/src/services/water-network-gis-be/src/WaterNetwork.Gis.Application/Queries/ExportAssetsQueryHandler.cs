using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class ExportAssetsQueryHandler(
    IExportAssetReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<ExportAssetsQuery, AssetExportPageDto>
{
    public async Task<AssetExportPageDto> HandleAsync(ExportAssetsQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        // Fetch limit+1 to detect whether another page exists without a COUNT.
        var rows = await readDao.QueryAsync(tenant.TenantId, query.Cursor, query.Limit + 1, ct);

        var hasMore = rows.Count > query.Limit;
        var items = hasMore ? rows.Take(query.Limit).ToList() : rows.ToList();
        var nextCursor = hasMore ? items[^1].Id : null;

        return new AssetExportPageDto(items, nextCursor);
    }
}
