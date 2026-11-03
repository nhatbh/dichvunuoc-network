using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignProjectReadDao(DesignDbContext dbContext) : IDesignProjectReadDao
{
    public async Task<DesignProjectDetailDto?> GetDetailAsync(string tenantId, string projectId, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id AS Id, tenant_id AS TenantId, name AS Name, branch_id AS BranchId,
                   zone_id AS ZoneId, status AS Status, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM design_projects
            WHERE id = @projectId AND tenant_id = @tenantId
            """;
        var connection = dbContext.Database.GetDbConnection();
        return await connection.QuerySingleOrDefaultAsync<DesignProjectDetailDto>(
            new CommandDefinition(sql, new { projectId, tenantId }, cancellationToken: ct));
    }

    public async Task<bool> ExistsAsync(string tenantId, string projectId, CancellationToken ct = default)
    {
        const string sql = "SELECT EXISTS(SELECT 1 FROM design_projects WHERE id = @projectId AND tenant_id = @tenantId)";
        var connection = dbContext.Database.GetDbConnection();
        return await connection.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { projectId, tenantId }, cancellationToken: ct));
    }
}
