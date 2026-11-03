using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Services;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed record SaveNetworkEditsRequest(int ExpectedVersion, IReadOnlyList<NetworkEditOperationV1> Operations);

public sealed class NetworkEditsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/design/network-edits", async (DesignDbContext db, ITenantContextAccessor tenants, CancellationToken ct) =>
        {
            var tenant = tenants.Current ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
            return Results.Ok(await db.Set<DesignRevisionPersistenceModel>().AsNoTracking()
                .Where(x => x.TenantId == tenant.TenantId && x.NetworkEditsJson != null)
                .OrderByDescending(x => x.UpdatedAt).Take(200)
                .Select(x => new { x.Id, x.ProjectId, x.Status, x.Version, x.UpdatedAt }).ToListAsync(ct));
        }).RequirePermission("network-design:read");
        var group = app.MapGroup("/api/design/revisions/{revisionId}/network-edits");
        group.MapGet("", async (string revisionId, IDesignRevisionRepository revisions, ITenantContextAccessor tenants, CancellationToken ct) =>
        {
            var tenant = tenants.Current ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
            var revision = await revisions.GetByIdAsync(revisionId, ct);
            if (revision is null || revision.TenantId != tenant.TenantId) return Results.NotFound();
            return Results.Ok(new { revision.Id, revision.Version, status = revision.Status.ToString(),
                operations = revision.NetworkEdits?.Select(NetworkEditMapping.ToContract).ToArray() });
        }).RequirePermission("network-design:read");

        group.MapPut("", async (string revisionId, SaveNetworkEditsRequest request, IDesignRevisionRepository revisions,
            IDraftNetworkAssetRepository drafts, IGisLookupPort gis, ITenantContextAccessor tenants, CancellationToken ct) =>
        {
            var tenant = tenants.Current ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
            var revision = await revisions.GetByIdAsync(revisionId, ct);
            if (revision is null || revision.TenantId != tenant.TenantId) return Results.NotFound();
            revision.EnsureDraftsEditable();
            if (revision.Version != request.ExpectedVersion)
                throw ConcurrencyException.VersionMismatch(revision.Id, request.ExpectedVersion, revision.Version);
            if (request.Operations is null || request.Operations.Count > 2000 || request.Operations.Any(x => x is null))
                return Results.BadRequest(new { message = "Tối đa 2000 thay đổi trong một bản nháp." });
            if ((await drafts.ListByRevisionAsync(tenant.TenantId, revisionId, ct)).Count != 0)
                return Results.Conflict(new { message = "Hồ sơ CAD cần được giữ riêng với bản nháp biên tập mạng." });
            // Never accept the client's before image. GIS resolves targets within this tenant.
            var inspection = await gis.InspectEdits(tenant.TenantId,
                request.Operations.Select(x => x with { Before = null }).ToArray(), ct);
            var conflicts = inspection.Errors.Where(x => x.Code is "TARGET_CONFLICT" or "INVALID_OPERATION").ToArray();
            if (conflicts.Length > 0) return Results.Conflict(new { errors = conflicts });
            revision.SaveNetworkEdits(inspection.Operations.Select(NetworkEditMapping.ToDomain).ToArray(), request.ExpectedVersion);
            await revisions.SaveAsync(revision, ct);
            return Results.Ok(new { revision.Id, revision.Version, status = revision.Status.ToString(),
                operations = revision.NetworkEdits!.Select(NetworkEditMapping.ToContract).ToArray(), errors = inspection.Errors });
        }).RequirePermission("network-design:write");
    }
}
