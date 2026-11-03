using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignRevisionReadDao(DesignDbContext dbContext) : IDesignRevisionReadDao
{
    public async Task<DesignRevisionDetailDto?> GetDetailAsync(string tenantId, string revisionId, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignRevisionPersistenceModel>().AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == revisionId && x.TenantId == tenantId, ct);
        if (m is null) return null;

        ValidationResultDto? validation = null;
        if (!string.IsNullOrWhiteSpace(m.ValidationResultJson))
        {
            var raw = JsonSerializer.Deserialize<RawValidationResult>(m.ValidationResultJson);
            if (raw is not null)
                validation = new ValidationResultDto(
                    IsValid: raw.Errors.Count == 0,
                    Errors: raw.Errors.Select(ToDto).ToList(),
                    Warnings: raw.Warnings.Select(ToDto).ToList());
        }

        var transitions = await ListTransitionsAsync(tenantId, revisionId, ct);
        return new DesignRevisionDetailDto(m.Id, m.ProjectId, m.TenantId, m.RevisionNumber, m.Status, validation, transitions);
    }

    public async Task<IReadOnlyList<RevisionTransitionDto>> ListTransitionsAsync(
        string tenantId, string revisionId, CancellationToken ct = default)
    {
        var rows = await dbContext.Set<DesignRevisionTransitionPersistenceModel>().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RevisionId == revisionId)
            .OrderBy(x => x.OccurredAt).ThenBy(x => x.Id)
            .ToListAsync(ct);

        return rows.Select(x => new RevisionTransitionDto(
            x.FromStatus, x.ToStatus, x.ActorId, x.Reason, x.CorrelationId, x.OccurredAt)).ToList();
    }

    public async Task<bool> ExistsAsync(string tenantId, string revisionId, CancellationToken ct = default)
        => await dbContext.Set<DesignRevisionPersistenceModel>()
            .AnyAsync(x => x.Id == revisionId && x.TenantId == tenantId, ct);

    public async Task<IReadOnlyList<DraftAssetPreviewDto>> ListPreviewAsync(
        string tenantId, string revisionId, CancellationToken ct = default)
    {
        var models = await dbContext.Set<DraftNetworkAssetPersistenceModel>().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RevisionId == revisionId)
            .OrderBy(x => x.AssetCode)
            .ToListAsync(ct);

        return models.Select(m =>
        {
            var coords = m.Geometry.Coordinates
                .Select(c => (IReadOnlyList<double>)new[] { c.X, c.Y })
                .ToList();
            var type = m.Geometry is Point ? "Point" : "LineString";
            var attrs = JsonSerializer.Deserialize<Dictionary<string, string>>(m.AttributesJson)
                ?? new Dictionary<string, string>();
            return new DraftAssetPreviewDto(m.Id, m.DraftKind, m.AssetCode, m.ClientRef, type, coords,
                m.FromRef, m.ToRef, m.HostRef, attrs);
        }).ToList();
    }

    // Mirror of the Domain ValidationResult JSON shape (PascalCase as serialized by the repository).
    private sealed record RawValidationResult(
        List<RawIssue> Errors,
        List<RawIssue> Warnings);
    private sealed record RawIssue(string Code, string? DraftAssetId, string? ClientRef, string? Field, string Message);

    private static ValidationIssueDto ToDto(RawIssue i)
        => new(i.Code, i.DraftAssetId, i.ClientRef, i.Field, i.Message);
}
