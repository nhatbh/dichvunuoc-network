using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Entities;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Asset.Infrastructure.Repositories;

public sealed class NetworkAssetRepository(
    AssetDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkAsset>(dbContext, eventDispatcher, outboxRepository), INetworkAssetRepository
{
    public async Task<bool> ExistsAsync(string assetId, CancellationToken ct = default)
        => await dbContext.NetworkAssets.AnyAsync(x => x.Id == assetId, ct);

    public override async Task<NetworkAsset?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkAssets
            .AsNoTracking()
            .Include(x => x.LifecycleEntries)
            .Include(x => x.TechnicalProfile)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<NetworkAsset?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkAssets
            .AsNoTracking()
            .Include(x => x.LifecycleEntries)
            .Include(x => x.TechnicalProfile)
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return model is null ? null : ToDomain(model);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Assets are decommissioned via lifecycle commands (AST-2), not deleted.");

    protected override async Task PersistAsync(NetworkAsset aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.NetworkAssets
            .Include(x => x.LifecycleEntries)
            .Include(x => x.TechnicalProfile)
            .FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);

        if (existing is null)
        {
            if (expectedVersion > 0)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            dbContext.NetworkAssets.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);

            existing.Status = aggregate.Status.ToString();
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
            existing.DecommissionReason = aggregate.DecommissionReason;
            existing.DecommissionedBy = aggregate.DecommissionedBy;

            // Append-only lifecycle entries: insert the ones added since the last persist.
            var newEntries = aggregate.LifecycleEntries.Skip(existing.LifecycleEntries.Count);
            foreach (var e in newEntries)
                existing.LifecycleEntries.Add(new AssetLifecycleEntryPersistenceModel
                {
                    AssetId = aggregate.Id,
                    FromStatus = e.FromStatus.ToString(),
                    ToStatus = e.ToStatus.ToString(),
                    ActorId = e.ActorId,
                    Reason = e.Reason,
                    OccurredAt = e.OccurredAt
                });

            // Upsert 1-1 technical profile.
            if (aggregate.TechnicalProfile is { } tp)
            {
                if (existing.TechnicalProfile is null)
                {
                    existing.TechnicalProfile = new AssetTechnicalProfilePersistenceModel { AssetId = aggregate.Id };
                    // EF does not auto-track a new entity assigned via a string-PK nav property; Add() is required.
                    dbContext.AssetTechnicalProfiles.Add(existing.TechnicalProfile);
                }
                existing.TechnicalProfile.InstallationYear = tp.InstallationYear;
                existing.TechnicalProfile.Manufacturer = tp.Manufacturer;
                existing.TechnicalProfile.Model = tp.Model;
                existing.TechnicalProfile.AttributesJson = JsonSerializer.Serialize(tp.Attributes);
            }
        }
    }

    private static NetworkAssetPersistenceModel ToModel(NetworkAsset a) => new()
    {
        Id = a.Id,
        TenantId = a.TenantId,
        AssetType = a.AssetType.ToString(),
        AssetCode = a.AssetCode,
        Status = a.Status.ToString(),
        Version = a.Version,
        CreatedAt = a.CreatedAt,
        UpdatedAt = a.UpdatedAt,
        DecommissionReason = a.DecommissionReason,
        DecommissionedBy = a.DecommissionedBy,
        LifecycleEntries = a.LifecycleEntries.Select(e => new AssetLifecycleEntryPersistenceModel
        {
            AssetId = a.Id,
            FromStatus = e.FromStatus.ToString(),
            ToStatus = e.ToStatus.ToString(),
            ActorId = e.ActorId,
            Reason = e.Reason,
            OccurredAt = e.OccurredAt
        }).ToList(),
        TechnicalProfile = a.TechnicalProfile is { } tp ? new AssetTechnicalProfilePersistenceModel
        {
            AssetId = a.Id,
            InstallationYear = tp.InstallationYear,
            Manufacturer = tp.Manufacturer,
            Model = tp.Model,
            AttributesJson = JsonSerializer.Serialize(tp.Attributes)
        } : null
    };

    private static NetworkAsset ToDomain(NetworkAssetPersistenceModel m)
    {
        AssetTechnicalProfile? profile = m.TechnicalProfile is null ? null :
            new AssetTechnicalProfile(
                m.TechnicalProfile.InstallationYear, m.TechnicalProfile.Manufacturer, m.TechnicalProfile.Model,
                JsonSerializer.Deserialize<Dictionary<string, string?>>(m.TechnicalProfile.AttributesJson)
                    ?? new Dictionary<string, string?>());
        return NetworkAsset.Reconstitute(
            m.Id, m.TenantId, Enum.Parse<AssetType>(m.AssetType), m.AssetCode, Enum.Parse<AssetStatus>(m.Status),
            m.Version, m.CreatedAt, m.UpdatedAt,
            m.LifecycleEntries.Select(e => new AssetLifecycleEntry(
                Enum.Parse<AssetStatus>(e.FromStatus), Enum.Parse<AssetStatus>(e.ToStatus),
                e.ActorId, e.Reason, e.OccurredAt)),
            m.DecommissionReason, m.DecommissionedBy, profile);
    }
}
