using WaterNetwork.Asset.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Asset.Application.Commands;

public sealed class SuspendAssetCommandHandler(
    INetworkAssetRepository repository, ITenantContextAccessor tenantAccessor, IRequestContextProvider ctx)
    : ICommandHandler<SuspendAssetCommand, string>
{
    public async Task<string> HandleAsync(SuspendAssetCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        var asset = await repository.GetByIdAsync(tenant.TenantId, command.AssetId, ct)
            ?? throw NotFoundException.Entity("NetworkAsset", command.AssetId);
        var changedBy = ctx.Current()?.UserId ?? tenant.TenantId;
        asset.Suspend(changedBy, command.Reason);
        await repository.SaveAsync(asset, ct);
        return asset.Id;
    }
}
