using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class CreateDesignRevisionCommandHandler(
    IDesignProjectReadDao projects,
    IDesignRevisionRepository revisions,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<CreateDesignRevisionCommand, string>
{
    public async Task<string> HandleAsync(CreateDesignRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to create a revision.");

        // Project must exist + belong to caller's tenant (404 also hides cross-tenant ids).
        if (!await projects.ExistsAsync(tenant.TenantId, command.ProjectId, ct))
            throw NotFoundException.Entity("DesignProject", command.ProjectId);

        var next = await revisions.GetNextRevisionNumberAsync(tenant.TenantId, command.ProjectId, ct);
        var revision = DesignRevision.Create(command.ProjectId, tenant.TenantId, next);
        await revisions.SaveAsync(revision, ct);
        return revision.Id;
    }
}
