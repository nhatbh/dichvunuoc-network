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

public sealed class NetworkDeviceRepository(
    GisDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkDevice>(dbContext, eventDispatcher, outboxRepository), INetworkDeviceRepository
{
    public override async Task<NetworkDevice?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkDevices.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<NetworkDevice?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkDevices.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default)
        => await dbContext.NetworkDevices.AnyAsync(x => x.TenantId == tenantId && x.AssetCode == assetCode, ct);

    public override async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        // Load the aggregate (tracked) so SoftDelete can raise the DeviceDeleted domain event,
        // and route the resulting state mutation through the outbox-aware SaveAsync path.
        var device = await GetByIdAsync(id, ct);
        if (device is null) return;   // already gone / soft-deleted (query filter) — no-op

        device.SoftDelete();
        await SaveAsync(device, ct);
    }

    // Returns true if any live device is hosted on the given pipe.
    // The HasQueryFilter(DeletedAt == null) on NetworkDeviceConfiguration already excludes
    // soft-deleted devices, so only live devices count.
    public async Task<bool> ExistsByHostPipeAsync(string pipeId, CancellationToken ct = default)
        => await dbContext.NetworkDevices.AnyAsync(x => x.HostPipeId == pipeId, ct);

    // Returns true if any live device is hosted on the given node.
    // Same query filter (DeletedAt == null) — only live devices count.
    public async Task<bool> ExistsByHostNodeAsync(string nodeId, CancellationToken ct = default)
        => await dbContext.NetworkDevices.AnyAsync(x => x.HostNodeId == nodeId, ct);

    protected override async Task PersistAsync(NetworkDevice aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.NetworkDevices.FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
        if (existing is null)
        {
            if (expectedVersion > 0)
            {
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            }

            dbContext.NetworkDevices.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
            {
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);
            }

            existing.AssetCode = aggregate.AssetCode.Value;
            existing.DeviceType = aggregate.DeviceType.ToString();
            existing.HostPipeId = aggregate.Host.HostPipeId;
            existing.HostNodeId = aggregate.Host.HostNodeId;
            existing.Location = ToPoint(aggregate.Location);
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
            existing.DeletedAt = aggregate.DeletedAt;
        }
    }

    // Coordinate order in NTS: X = longitude, Y = latitude — mirrors NetworkPipeRepository.ToCoordinate.
    private static Point ToPoint(GeoPoint p) => new(p.Longitude, p.Latitude) { SRID = GeoPoint.Srid };

    private static NetworkDevicePersistenceModel ToModel(NetworkDevice device) => new()
    {
        Id = device.Id,
        TenantId = device.TenantId,
        AssetCode = device.AssetCode.Value,
        DeviceType = device.DeviceType.ToString(),
        HostPipeId = device.Host.HostPipeId,
        HostNodeId = device.Host.HostNodeId,
        Location = ToPoint(device.Location),
        Status = "Active",
        Version = device.Version,
        CreatedAt = device.CreatedAt,
        UpdatedAt = device.UpdatedAt,
        DeletedAt = device.DeletedAt
    };

    private static NetworkDevice ToDomain(NetworkDevicePersistenceModel model)
    {
        var deviceType = DeviceType.Parse(model.DeviceType);
        return NetworkDevice.Reconstitute(
            model.Id,
            model.TenantId,
            new AssetCode(model.AssetCode),
            deviceType,
            DeviceHost.For(deviceType, model.HostPipeId, model.HostNodeId),
            new GeoPoint(model.Location.Y, model.Location.X),   // Y = lat, X = lng
            model.Version,
            model.CreatedAt,
            model.UpdatedAt,
            model.DeletedAt);
    }
}
