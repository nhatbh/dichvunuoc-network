using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Domain.Aggregates;

public sealed class NetworkNode : AggregateRoot
{
    public string TenantId { get; private set; }
    public AssetCode AssetCode { get; private set; }
    public NodeType NodeType { get; private set; }
    public GeoPoint Location { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    private NetworkNode(
        string id,
        string tenantId,
        AssetCode assetCode,
        NodeType nodeType,
        GeoPoint location,
        int version = 0,
        DateTime? createdAt = null,
        DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        AssetCode = assetCode;
        NodeType = nodeType;
        Location = location;
    }

    public static NetworkNode Register(
        string tenantId,
        AssetCode assetCode,
        NodeType nodeType,
        GeoPoint location)
    {
        var node = new NetworkNode(
            id: $"node-{Guid.CreateVersion7():N}",
            tenantId: tenantId,
            assetCode: assetCode,
            nodeType: nodeType,
            location: location);

        var data = new NodeRegisteredData(
            TenantId: tenantId,
            AssetCode: assetCode.Value,
            NodeType: nodeType.ToString(),
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
            NodeType: NodeType.ToString());

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

    public void Edit(AssetCode code, NodeType type, GeoPoint location)
    {
        if (DeletedAt != null || !Enum.IsDefined(type)) throw new DomainException("NetworkNode.InvalidEdit", "Cannot edit a deleted node or use invalid type.");
        AssetCode=code; NodeType=type; Location=location;
        MarkAsModified(); AddDomainEvent(new NetworkAssetEdited(Id,new(TenantId,"Node",AssetCode.Value,Version)));
    }

    public static NetworkNode Reconstitute(
        string id,
        string tenantId,
        AssetCode assetCode,
        NodeType nodeType,
        GeoPoint location,
        int version,
        DateTime createdAt,
        DateTime updatedAt,
        DateTime? deletedAt = null)
        => new(id, tenantId, assetCode, nodeType, location, version, createdAt, updatedAt)
        {
            DeletedAt = deletedAt
        };
}
