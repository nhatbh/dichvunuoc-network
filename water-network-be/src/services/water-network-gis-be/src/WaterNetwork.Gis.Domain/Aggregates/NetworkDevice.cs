using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Gis.Domain.Aggregates;

public sealed class NetworkDevice : AggregateRoot
{
    public string TenantId { get; private set; }
    public AssetCode AssetCode { get; private set; }
    public ComponentCode Component { get; private set; }
    public AssetProperties Properties { get; private set; }
    public DeviceHost Host { get; private set; }
    public GeoPoint Location { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    private NetworkDevice(
        string id,
        string tenantId,
        AssetCode assetCode,
        ComponentCode component,
        AssetProperties properties,
        DeviceHost host,
        GeoPoint location,
        int version = 0,
        DateTime? createdAt = null,
        DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        AssetCode = assetCode;
        Component = component;
        Properties = properties;
        Host = host;
        Location = location;
    }

    public static NetworkDevice Install(
        string tenantId,
        AssetCode assetCode,
        ComponentCode component,
        DeviceHost host,
        GeoPoint location,
        AssetProperties? properties = null)
    {
        var device = new NetworkDevice(
            id: $"device-{Guid.CreateVersion7():N}",
            tenantId: tenantId,
            assetCode: assetCode,
            component: component,
            properties: properties ?? AssetProperties.Empty,
            host: DeviceHost.For(component, host.HostPipeId, host.HostNodeId),
            location: location);

        var data = new DeviceInstalledData(
            TenantId: tenantId,
            AssetCode: assetCode.Value,
            ComponentCode: component.Value,
            Functions: component.Definition.Functions,
            Properties: device.Properties.Values,
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
            ComponentCode: Component.Value);

        AddDomainEvent(new DeviceDeleted(Id, data));
    }

    public void Edit(AssetCode code, ComponentCode component, DeviceHost host, GeoPoint location, AssetProperties? properties = null)
    {
        if (DeletedAt != null) throw new WaterPlatform.BuildingBlocks.Domain.Exceptions.DomainException("NetworkDevice.InvalidEdit", "Cannot edit a deleted device.");
        AssetCode=code; Component=component; Host=DeviceHost.For(component,host.HostPipeId,host.HostNodeId); Location=location; Properties=properties ?? AssetProperties.Empty;
        MarkAsModified(); AddDomainEvent(new NetworkAssetEdited(Id,new(TenantId,"Device",AssetCode.Value,Version)));
    }

    public static NetworkDevice Reconstitute(
        string id,
        string tenantId,
        AssetCode assetCode,
        ComponentCode component,
        DeviceHost host,
        GeoPoint location,
        int version,
        DateTime createdAt,
        DateTime updatedAt,
        DateTime? deletedAt = null,
        AssetProperties? properties = null)
        => new(id, tenantId, assetCode, component, properties ?? AssetProperties.Empty, host, location, version, createdAt, updatedAt)
        {
            DeletedAt = deletedAt
        };
}
