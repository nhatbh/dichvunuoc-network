using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Domain.Aggregates;

public sealed class NetworkNode : AggregateRoot
{
    public string TenantId { get; private set; }
    public AssetCode AssetCode { get; private set; }
    public ComponentCode Component { get; private set; }
    public AssetProperties Properties { get; private set; }
    public GeoPoint Location { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    private NetworkNode(
        string id,
        string tenantId,
        AssetCode assetCode,
        ComponentCode component,
        AssetProperties properties,
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
        Location = location;
    }

    public static NetworkNode Register(
        string tenantId,
        AssetCode assetCode,
        ComponentCode component,
        GeoPoint location,
        AssetProperties? properties = null)
    {
        EnsureNode(component);
        var node = new NetworkNode(
            id: $"node-{Guid.CreateVersion7():N}",
            tenantId: tenantId,
            assetCode: assetCode,
            component: component,
            properties: properties ?? AssetProperties.Empty,
            location: location);

        var data = new NodeRegisteredData(
            TenantId: tenantId,
            AssetCode: assetCode.Value,
            ComponentCode: component.Value,
            Functions: component.Definition.Functions,
            Properties: node.Properties.Values,
            Latitude: location.Latitude,
            Longitude: location.Longitude);

        var evt = new NodeRegistered(node.Id, data);
        node.AddDomainEvent(evt);
        return node;
    }

    /// <summary>
    /// Soft-deletes this aggregate: stamps <see cref="DeletedAt"/>, bumps the version, and raises
    /// a <see cref="NodeDeleted"/> domain event so downstream subscribers (search-index
    /// projectors, integration event mappers, etc.) can react to the tombstone.
    /// </summary>
    public void SoftDelete()
    {
        DeletedAt = DateTime.UtcNow;
        MarkAsModified();

        var data = new NodeDeletedData(
            TenantId: TenantId,
            AssetCode: AssetCode.Value,
            ComponentCode: Component.Value);

        AddDomainEvent(new NodeDeleted(Id, data));
    }

    /// <summary>
    /// Relocates this node to a new geographic position, bumps the version, and raises a
    /// <see cref="NodeRelocated"/> domain event.
    /// </summary>
    /// <param name="newLocation">The new geographic location. Must differ from the current location.</param>
    /// <param name="reason">Optional human-readable reason for the relocation (e.g. "survey fix").</param>
    /// <exception cref="DomainException">Thrown when <paramref name="newLocation"/> equals the current location.</exception>
    public void Relocate(GeoPoint newLocation, string? reason)
    {
        if (newLocation.Equals(Location))
            throw new DomainException("NetworkNode.NoLocationChange",
                "New location is identical to the current location.");

        var old = Location;
        Location = newLocation;
        MarkAsModified();

        AddDomainEvent(new NodeRelocated(Id, new NodeRelocatedData(
            TenantId: TenantId,
            AssetCode: AssetCode.Value,
            OldLatitude: old.Latitude,
            OldLongitude: old.Longitude,
            NewLatitude: newLocation.Latitude,
            NewLongitude: newLocation.Longitude,
            Reason: reason)));
    }

    public void Edit(AssetCode code, ComponentCode component, GeoPoint location, AssetProperties? properties = null)
    {
        if (DeletedAt != null) throw new DomainException("NetworkNode.InvalidEdit", "Cannot edit a deleted node.");
        EnsureNode(component);
        AssetCode=code; Component=component; Location=location; Properties=properties ?? AssetProperties.Empty;
        MarkAsModified(); AddDomainEvent(new NetworkAssetEdited(Id,new(TenantId,"Node",AssetCode.Value,Version)));
    }

    private static void EnsureNode(ComponentCode component)
    {
        if (component.Definition.Kind != WaterPlatform.BuildingBlocks.Components.ComponentKind.Node)
            throw new DomainException("NetworkNode.NotANode", $"'{component}' is not a node component.");
    }

    public static NetworkNode Reconstitute(
        string id,
        string tenantId,
        AssetCode assetCode,
        ComponentCode component,
        GeoPoint location,
        int version,
        DateTime createdAt,
        DateTime updatedAt,
        DateTime? deletedAt = null,
        AssetProperties? properties = null)
        => new(id, tenantId, assetCode, component, properties ?? AssetProperties.Empty, location, version, createdAt, updatedAt)
        {
            DeletedAt = deletedAt
        };
}
