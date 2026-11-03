using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignImportIngestor(
    DesignDbContext db, IDesignProjectRepository projects, IDesignRevisionRepository revisions,
    ICommandBus commands, ITenantContextAccessor tenantAccessor) : IDesignImportIngestor
{
    public async Task<DesignImportReceipt> IngestAsync(DesignImportInput input, CancellationToken ct)
    {
        var tenantId = tenantAccessor.Current?.TenantId
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to import a design.");
        var identityHash = SHA256.HashData(Encoding.UTF8.GetBytes(tenantId + "\0" + input.ImportKey));
        var digest = CanonicalDigest(input);
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            // The transaction owns every repository SaveChanges and transactional outbox row.
            // A retried execution must not retain entities from a rolled-back attempt.
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var lockId = BinaryPrimitives.ReadInt64BigEndian(identityHash);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({lockId})", ct);
            var existing = await db.Set<DesignImportReceiptPersistenceModel>().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.ImportKey == input.ImportKey, ct);
            if (existing is not null)
            {
                if (existing.PayloadSha256 != digest)
                    throw ConflictException.Duplicate("DesignImport payload", "importKey", input.ImportKey);
                return new DesignImportReceipt(existing.ProjectId, existing.RevisionId, existing.AssetCount);
            }

            // Existing project names are tenant-unique. Include a stable import identity so a
            // new file version can create a separate reviewable project with the same title.
            var projectName = $"{input.Name} [import {Convert.ToHexString(identityHash)[..16]}]";
            var project = DesignProject.Create(tenantId, projectName, null, null);
            await projects.SaveAsync(project, ct);
            var revision = DesignRevision.Create(project.Id, tenantId, 1);
            await revisions.SaveAsync(revision, ct);
            await commands.ExecuteAsync(new CreateDraftAssetsBatchCommand(revision.Id, input.Assets), ct);
            db.Add(new DesignImportReceiptPersistenceModel
            {
                TenantId = tenantId, ImportKey = input.ImportKey, PayloadSha256 = digest,
                ProjectId = project.Id, RevisionId = revision.Id, AssetCount = input.Assets.Count,
                ProvenanceJson = input.Provenance.GetRawText(), CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new DesignImportReceipt(project.Id, revision.Id, input.Assets.Count);
        });
    }

    private static string CanonicalDigest(DesignImportInput input)
    {
        var value = JsonSerializer.SerializeToElement(input);
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output)) WriteCanonical(writer, value);
        return Convert.ToHexString(SHA256.HashData(output.GetBuffer().AsSpan(0, checked((int)output.Length))));
    }

    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
            {
                writer.WritePropertyName(property.Name);
                WriteCanonical(writer, property.Value);
            }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            writer.WriteStartArray();
            foreach (var item in value.EnumerateArray()) WriteCanonical(writer, item);
            writer.WriteEndArray();
        }
        else value.WriteTo(writer);
    }
}
