using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Gis.Domain.Aggregates;

public sealed class NetworkDevice : AggregateRoot
{
    public string TenantId { get; private set; }
    public AssetCode AssetCode { get; private set; }
    public DeviceType DeviceType { get; private set; }
    public DeviceHost Host { get; private set; }
    public GeoPoint Location { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    private NetworkDevice(
        string id,
        string tenantId,
        AssetCode assetCode,
        DeviceType deviceType,
        DeviceHost host,
        GeoPoint location,
        int version = 0,
        DateTime? createdAt = null,
        DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        AssetCode = assetCode;
        DeviceType = deviceType;
        Host = host;
        Location = location;
    }

    public static NetworkDevice Install(
        string tenantId,
        AssetCode assetCode,
        DeviceType deviceType,
        DeviceHost host,
        GeoPoint location)
    {
        var device = new NetworkDevice(
            id: $"device-{Guid.CreateVersion7():N}",
            tenantId: tenantId,
            assetCode: assetCode,
            deviceType: deviceType,
            host: host,
            location: location);

        var data = new DeviceInstalledData(
            TenantId: tenantId,
            AssetCode: assetCode.Value,
            DeviceType: deviceType.ToString(),
            HostPipeId: host.HostPipeId,
            HostNodeId: host.HostNodeId,
            Latitude: location.Latitude,
            Longitude: location.Longitude);

        device.AddDomainEvent(new DeviceInstalled(device.Id, data));
        return device;
    }

    /// <summary>
    /// Soft-deletes this aggregate: stamps <see cref="DeletedAt"/>, bumps the version, and raises
    /// a <see cref="DeviceDeleted"/> domain event so downstream subscribers (search-index
    /// projectors, integration event mappers, etc.) can react to the tombstone.
    /// </summary>
    public void SoftDelete()
    {
        DeletedAt = DateTime.UtcNow;
        MarkAsModified();

        var data = new DeviceDeletedData(
            TenantId: TenantId,
            AssetCode: AssetCode.Value,
            DeviceType: DeviceType.ToString());

        AddDomainEvent(new DeviceDeleted(Id, data));
    }

    public void Edit(AssetCode code, DeviceType type, DeviceHost host, GeoPoint location)
    {
        if (DeletedAt != null) throw new WaterPlatform.BuildingBlocks.Domain.Exceptions.DomainException("NetworkDevice.InvalidEdit", "Cannot edit a deleted device.");
        AssetCode=code; DeviceType=type; Host=DeviceHost.For(type,host.HostPipeId,host.HostNodeId); Location=location;
        MarkAsModified(); AddDomainEvent(new NetworkAssetEdited(Id,new(TenantId,"Device",AssetCode.Value,Version)));
    }

    public static NetworkDevice Reconstitute(
        string id,
        string tenantId,
        AssetCode assetCode,
        DeviceType deviceType,
        DeviceHost host,
        GeoPoint location,
        int version,
        DateTime createdAt,
        DateTime updatedAt,
        DateTime? deletedAt = null)
        => new(id, tenantId, assetCode, deviceType, host, location, version, createdAt, updatedAt)
        {
            DeletedAt = deletedAt
        };
}
