using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class ApproveDesignRevisionCommandHandler(
    IDesignRevisionRepository revisions,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<ApproveDesignRevisionCommand, Unit>
{
    public async Task<Unit> HandleAsync(ApproveDesignRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        var ctx = requestContextProvider.Current();
        revision.Approve(ctx?.UserId ?? "unknown", command.Reason, ctx?.CorrelationId);
        await revisions.SaveAsync(revision, ct);
        return Unit.Value;
    }
}
