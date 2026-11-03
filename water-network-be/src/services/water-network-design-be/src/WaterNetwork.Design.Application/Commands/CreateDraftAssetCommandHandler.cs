// CreateDraftAssetCommandHandler.cs
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class CreateDraftAssetCommandHandler(
    IDesignRevisionRepository revisions,
    IDraftNetworkAssetRepository drafts,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<CreateDraftAssetCommand, string>
{
    public async Task<string> HandleAsync(CreateDraftAssetCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        revision.EnsureDraftsEditable();
        if (revision.NetworkEdits is not null)
            throw BusinessRuleException.Violation("MixedRevisionContent", "Network edit revisions cannot contain CAD draft assets.");

        revision.MarkDraftsChanged();
        await revisions.SaveAsync(revision, ct);

        var draft = DraftAssetMapper.ToDraft(revision.Id, tenant.TenantId, command.Asset);
        await drafts.AddAsync(draft, ct);
        return draft.Id;
    }
}
