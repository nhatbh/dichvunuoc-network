using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class NetworkNodeRepository(
    GisDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkNode>(dbContext, eventDispatcher, outboxRepository), INetworkNodeRepository
{
    public override async Task<NetworkNode?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkNodes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<NetworkNode?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkNodes.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default)
        => await dbContext.NetworkNodes.AnyAsync(x => x.TenantId == tenantId && x.AssetCode == assetCode, ct);

    public override async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        // Load the aggregate (tracked) so SoftDelete can raise the NodeDeleted domain event,
        // and route the resulting state mutation through the outbox-aware SaveAsync path.
        var node = await GetByIdAsync(id, ct);
        if (node is null) return;

        node.SoftDelete();
        await SaveAsync(node, ct);
    }

    /// <summary>
    /// Stages the aggregate for persistence and enforces optimistic concurrency.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the platform's intent-level optimistic concurrency check, complementary to the
    /// EF Core <c>xmin</c>-style <c>IsConcurrencyToken()</c> configured on the persistence model.
    /// The EF token guards the database write (raw <c>UPDATE ... WHERE version = ?</c>), while
    /// this check guards the application-level invariant that a caller holding a stale aggregate
    /// (i.e. an aggregate whose <c>Version</c> has already been advanced by a concurrent save) is
    /// rejected before any mutation is staged — yielding a precise, typed
    /// <see cref="ConcurrencyException"/> with the expected vs. actual version, rather than a
    /// generic <c>DbUpdateConcurrencyException</c> leaking out of the repository.
    /// </para>
    /// <para>
    /// On insert: a fresh <see cref="NetworkNode.Register"/> produces <c>expectedVersion = -1</c>
    /// (Version=0 minus 1 event), which is the legitimate "no prior version" sentinel. A positive
    /// <paramref name="expectedVersion"/> on insert means the caller reconstituted a snapshot of
    /// an existing row, but the row has since been hard-deleted / replaced — reject that as a
    /// version mismatch.
    /// On update: if the stored version does not match the caller's expected version, a
    /// concurrent writer has already mutated the aggregate.
    /// </para>
    /// </remarks>
    protected override async Task PersistAsync(NetworkNode aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.NetworkNodes.FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
        if (existing is null)
        {
            if (expectedVersion > 0)
            {
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            }

            dbContext.NetworkNodes.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
            {
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);
            }

            existing.AssetCode = aggregate.AssetCode.Value;
            existing.NodeType = aggregate.NodeType.ToString();
            existing.Location = ToPoint(aggregate.Location);
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
            existing.DeletedAt = aggregate.DeletedAt;
        }
    }

    private static Point ToPoint(GeoPoint p) => new(p.Longitude, p.Latitude) { SRID = GeoPoint.Srid };

    private static NetworkNodePersistenceModel ToModel(NetworkNode node) => new()
    {
        Id = node.Id,
        TenantId = node.TenantId,
        AssetCode = node.AssetCode.Value,
        NodeType = node.NodeType.ToString(),
        Location = ToPoint(node.Location),
        Version = node.Version,
        CreatedAt = node.CreatedAt,
        UpdatedAt = node.UpdatedAt,
        DeletedAt = node.DeletedAt
    };

    private static NetworkNode ToDomain(NetworkNodePersistenceModel model)
        => NetworkNode.Reconstitute(
            model.Id, model.TenantId, new AssetCode(model.AssetCode),
            Enum.Parse<NodeType>(model.NodeType), new GeoPoint(model.Location.Y, model.Location.X),
            model.Version, model.CreatedAt, model.UpdatedAt, model.DeletedAt);
}
