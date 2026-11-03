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

public sealed class NetworkPipeRepository(
    GisDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkPipe>(dbContext, eventDispatcher, outboxRepository), INetworkPipeRepository
{
    public override async Task<NetworkPipe?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkPipes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<NetworkPipe?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkPipes.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default)
        => await dbContext.NetworkPipes.AnyAsync(x => x.TenantId == tenantId && x.AssetCode == assetCode, ct);

    public override async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        // Load the aggregate (tracked) so SoftDelete can raise the PipeDeleted domain event,
        // and route the resulting state mutation through the outbox-aware SaveAsync path.
        var pipe = await GetByIdAsync(id, ct);
        if (pipe is null) return;   // already gone / soft-deleted (query filter) — no-op

        pipe.SoftDelete();
        await SaveAsync(pipe, ct);
    }

    // Returns true if any live pipe references nodeId as either endpoint.
    // The HasQueryFilter(DeletedAt == null) on NetworkPipeConfiguration already excludes
    // soft-deleted pipes, so only live pipes count — a removed pipe does NOT block node removal.
    public async Task<bool> ExistsByEndpointNodeAsync(string nodeId, CancellationToken ct = default)
        => await dbContext.NetworkPipes
            .AnyAsync(x => x.FromNodeId == nodeId || x.ToNodeId == nodeId, ct);

    protected override async Task PersistAsync(NetworkPipe aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.NetworkPipes.FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
        if (existing is null)
        {
            if (expectedVersion > 0)
            {
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            }

            dbContext.NetworkPipes.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
            {
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);
            }

            existing.AssetCode = aggregate.AssetCode.Value;
            existing.FromNodeId = aggregate.FromNodeId;
            existing.ToNodeId = aggregate.ToNodeId;
            existing.Geometry = ToLineString(aggregate.Geometry);
            existing.DiameterMm = Convert.ToInt32(aggregate.DiameterMm.Value);
            existing.Material = aggregate.Material.ToString();
            existing.LengthM = aggregate.LengthM;
            existing.LengthValidationWarning = aggregate.LengthValidationWarning;
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
            existing.DeletedAt = aggregate.DeletedAt;
        }
    }

    // Coordinate order in NTS: X = longitude, Y = latitude — exactly matching ToPoint in NodeRepository.
    private static Coordinate ToCoordinate(GeoPoint p) => new(p.Longitude, p.Latitude);

    private static LineString ToLineString(PipeGeometry geometry)
    {
        var coordinates = geometry.Points.Select(ToCoordinate).ToArray();
        return new LineString(coordinates) { SRID = GeoPoint.Srid };
    }

    private static NetworkPipePersistenceModel ToModel(NetworkPipe pipe) => new()
    {
        Id = pipe.Id,
        TenantId = pipe.TenantId,
        AssetCode = pipe.AssetCode.Value,
        FromNodeId = pipe.FromNodeId,
        ToNodeId = pipe.ToNodeId,
        Geometry = ToLineString(pipe.Geometry),
        DiameterMm = Convert.ToInt32(pipe.DiameterMm.Value),
        Material = pipe.Material.ToString(),
        LengthM = pipe.LengthM,
        LengthValidationWarning = pipe.LengthValidationWarning,
        Status = "Active",
        Version = pipe.Version,
        CreatedAt = pipe.CreatedAt,
        UpdatedAt = pipe.UpdatedAt,
        DeletedAt = pipe.DeletedAt
    };

    private static NetworkPipe ToDomain(NetworkPipePersistenceModel model)
        => NetworkPipe.Reconstitute(
            model.Id,
            model.TenantId,
            new AssetCode(model.AssetCode),
            model.FromNodeId,
            model.ToNodeId,
            new PipeGeometry(model.Geometry.Coordinates
                .Select(c => new GeoPoint(c.Y, c.X))   // Y = lat, X = lng — mirrors NodeRepository.ToPoint
                .ToList()),
            new Diameter(model.DiameterMm),
            PipeMaterial.Parse(model.Material),
            model.LengthM,
            model.LengthValidationWarning,
            model.Version,
            model.CreatedAt,
            model.UpdatedAt,
            model.DeletedAt);
}
