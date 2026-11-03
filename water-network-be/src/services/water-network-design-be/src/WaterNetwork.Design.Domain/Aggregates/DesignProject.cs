using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Design.Domain.Aggregates;

public sealed class DesignProject : AggregateRoot
{
    public string TenantId { get; private set; }
    public string Name { get; private set; }
    public string? BranchId { get; private set; }
    public string? ZoneId { get; private set; }
    public DesignProjectStatus Status { get; private set; }

    private DesignProject(
        string id, string tenantId, string name, string? branchId, string? zoneId,
        DesignProjectStatus status, int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        Name = name;
        BranchId = branchId;
        ZoneId = zoneId;
        Status = status;
    }

    public static DesignProject Create(string tenantId, string name, string? branchId, string? zoneId)
    {
        var project = new DesignProject(
            Guid.CreateVersion7().ToString(), tenantId, name, branchId, zoneId, DesignProjectStatus.Open);
        project.MarkAsModified();
        project.AddDomainEvent(new DesignProjectCreated(
            project.Id, new DesignProjectCreatedData(tenantId, name, branchId, zoneId)));
        return project;
    }

    public static DesignProject Reconstitute(
        string id, string tenantId, string name, string? branchId, string? zoneId,
        DesignProjectStatus status, int version, DateTime createdAt, DateTime updatedAt)
        => new(id, tenantId, name, branchId, zoneId, status, version, createdAt, updatedAt);
}
