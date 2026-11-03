using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Domain.Aggregates;

public sealed class NetworkPipe : AggregateRoot
{
    public string TenantId { get; private set; }
    public AssetCode AssetCode { get; private set; }
    public string FromNodeId { get; private set; }
    public string ToNodeId { get; private set; }
    public PipeGeometry Geometry { get; private set; }
    public Diameter DiameterMm { get; private set; }
    public PipeMaterial Material { get; private set; }
    public double LengthM { get; private set; }
    public string? LengthValidationWarning { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    private NetworkPipe(
        string id,
        string tenantId,
        AssetCode assetCode,
        string fromNodeId,
        string toNodeId,
        PipeGeometry geometry,
        Diameter diameterMm,
        PipeMaterial material,
        double lengthM,
        string? lengthValidationWarning,
        int version = 0,
        DateTime? createdAt = null,
        DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        AssetCode = assetCode;
        FromNodeId = fromNodeId;
        ToNodeId = toNodeId;
        Geometry = geometry;
        DiameterMm = diameterMm;
        Material = material;
        LengthM = lengthM;
        LengthValidationWarning = lengthValidationWarning;
    }

    public static NetworkPipe Register(
        string tenantId,
        AssetCode assetCode,
        string fromNodeId,
        string toNodeId,
        PipeGeometry geometry,
        Diameter diameterMm,
        PipeMaterial material,
        double lengthM,
        string? lengthValidationWarning)
    {
        if (fromNodeId == toNodeId)
            throw new DomainException(
                "NetworkPipe.SelfLoop",
                $"A pipe cannot connect a node to itself (fromNodeId == toNodeId == '{fromNodeId}').");

        var pipe = new NetworkPipe(
            id: $"pipe-{Guid.CreateVersion7():N}",
            tenantId: tenantId,
            assetCode: assetCode,
            fromNodeId: fromNodeId,
            toNodeId: toNodeId,
            geometry: geometry,
            diameterMm: diameterMm,
            material: material,
            lengthM: lengthM,
            lengthValidationWarning: lengthValidationWarning);

        var data = new PipeRegisteredData(
            TenantId: tenantId,
            AssetCode: assetCode.Value,
            FromNodeId: fromNodeId,
            ToNodeId: toNodeId,
            Points: geometry.Points,
            DiameterMm: diameterMm.Value,
            Material: material.ToString(),
            LengthM: lengthM);

        pipe.AddDomainEvent(new PipeRegistered(pipe.Id, data));
        return pipe;
    }

    /// <summary>
    /// Soft-deletes this aggregate: stamps <see cref="DeletedAt"/>, bumps the version, and raises
    /// a <see cref="PipeDeleted"/> domain event so downstream subscribers (search-index
    /// projectors, integration event mappers, etc.) can react to the tombstone.
    /// </summary>
    public void SoftDelete()
    {
        DeletedAt = DateTime.UtcNow;
        MarkAsModified();

        var data = new PipeDeletedData(
            TenantId: TenantId,
            AssetCode: AssetCode.Value);

        AddDomainEvent(new PipeDeleted(Id, data));
    }

    public void Edit(AssetCode code, string from, string to, PipeGeometry geometry, Diameter diameter, PipeMaterial material, double length)
    {
        if (DeletedAt != null || from == to || !double.IsFinite(length) || length <= 0)
            throw new DomainException("NetworkPipe.InvalidEdit", "Cannot edit a deleted pipe or use invalid endpoints/length.");
        AssetCode = code; FromNodeId = from; ToNodeId = to; Geometry = geometry;
        DiameterMm = diameter; Material = material; LengthM = length; LengthValidationWarning = null;
        MarkAsModified(); AddDomainEvent(new NetworkAssetEdited(Id, new(TenantId,"Pipe",AssetCode.Value,Version)));
    }

    public static NetworkPipe Reconstitute(
        string id,
        string tenantId,
        AssetCode assetCode,
        string fromNodeId,
        string toNodeId,
        PipeGeometry geometry,
        Diameter diameterMm,
        PipeMaterial material,
        double lengthM,
        string? lengthValidationWarning,
        int version,
        DateTime createdAt,
        DateTime updatedAt,
        DateTime? deletedAt = null)
        => new(id, tenantId, assetCode, fromNodeId, toNodeId, geometry, diameterMm, material,
               lengthM, lengthValidationWarning, version, createdAt, updatedAt)
        {
            DeletedAt = deletedAt
        };
}
