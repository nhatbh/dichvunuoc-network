using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class CreateDesignProjectCommandHandler(
    IDesignProjectRepository repository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<CreateDesignProjectCommand, string>
{
    public async Task<string> HandleAsync(CreateDesignProjectCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to create a design project.");

        if (await repository.ExistsByNameAsync(tenant.TenantId, command.Name, ct))
            throw ConflictException.Duplicate("DesignProject", nameof(command.Name), command.Name);

        var project = DesignProject.Create(tenant.TenantId, command.Name, command.BranchId, command.ZoneId);

        try
        {
            await repository.SaveAsync(project, ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("DesignProject", nameof(command.Name), command.Name);
        }

        return project.Id;
    }

    // PG unique-violation backstop (SqlState 23505) — same pattern as gis/asset handlers.
    // Walk the full InnerException chain: an execution/retry strategy can wrap the
    // PostgresException one extra level, so a one-level check would miss it.
    private static bool IsUniqueViolation(Exception? ex)
    {
        while (ex is not null)
        {
            if (ex is Npgsql.PostgresException pg)
                return pg.SqlState == "23505";
            ex = ex.InnerException;
        }
        return false;
    }
}
