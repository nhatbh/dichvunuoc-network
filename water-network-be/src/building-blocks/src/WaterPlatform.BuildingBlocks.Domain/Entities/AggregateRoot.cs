using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterPlatform.BuildingBlocks.Domain.Entities;

public abstract class AggregateRoot : Entity
{
    private readonly List<IDomainEvent> _domainEvents = [];
    public int Version { get; protected set; }

    protected AggregateRoot(string id, int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, createdAt, updatedAt)
    {
        Version = version;
    }

    public IReadOnlyList<IDomainEvent> GetDomainEvents() => _domainEvents.AsReadOnly();
    public void ClearDomainEvents() => _domainEvents.Clear();

    protected void AddDomainEvent(IDomainEvent domainEvent) => _domainEvents.Add(domainEvent);
    protected void MarkAsModified()
    {
        Version++;
        UpdatedAt = DateTime.UtcNow;
    }
}
