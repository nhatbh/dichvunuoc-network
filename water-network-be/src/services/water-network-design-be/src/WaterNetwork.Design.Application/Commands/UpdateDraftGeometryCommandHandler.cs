using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class UpdateDraftGeometryCommandHandler(
    IDesignRevisionRepository revisions,
    IDraftNetworkAssetRepository drafts,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<UpdateDraftGeometryCommand, Unit>
{
    public async Task<Unit> HandleAsync(UpdateDraftGeometryCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var draft = await drafts.GetByIdAsync(tenant.TenantId, command.DraftAssetId, ct);
        if (draft is null)
            throw NotFoundException.Entity("DraftNetworkAsset", command.DraftAssetId);

        var revision = await revisions.GetByIdAsync(draft.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", draft.RevisionId);
        revision.EnsureDraftsEditable();

        draft.UpdateGeometry(DraftGeometryFactory.FromInput(command.Geometry));
        await drafts.UpdateAsync(draft, ct);

        // A draft change invalidates a previously-Validated revision.
        revision.MarkDraftsChanged();
        await revisions.SaveAsync(revision, ct);

        return Unit.Value;
    }
}
