using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class SubmitDesignRevisionCommandHandler(
    IDesignRevisionRepository revisions,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<SubmitDesignRevisionCommand, Unit>
{
    public async Task<Unit> HandleAsync(SubmitDesignRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        var ctx = requestContextProvider.Current();
        revision.Submit(ctx?.UserId ?? "unknown", ctx?.CorrelationId);
        await revisions.SaveAsync(revision, ct);
        return Unit.Value;
    }
}
