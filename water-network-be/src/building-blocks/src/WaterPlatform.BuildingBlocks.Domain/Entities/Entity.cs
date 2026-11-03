namespace WaterPlatform.BuildingBlocks.Domain.Entities;

public abstract class Entity
{
    public string Id { get; }
    public DateTime CreatedAt { get; protected set; }
    public DateTime UpdatedAt { get; protected set; }

    protected Entity(string id, DateTime? createdAt = null, DateTime? updatedAt = null)
    {
        Id = !string.IsNullOrWhiteSpace(id) ? id : throw new ArgumentException("Entity ID cannot be empty.", nameof(id));
        var now = DateTime.UtcNow;
        CreatedAt = createdAt ?? now;
        UpdatedAt = updatedAt ?? now;
    }

    public override bool Equals(object? obj) => obj is Entity other && Id == other.Id;
    public override int GetHashCode() => Id.GetHashCode();
    public static bool operator ==(Entity? left, Entity? right) => Equals(left, right);
    public static bool operator !=(Entity? left, Entity? right) => !Equals(left, right);
}
