namespace WaterPlatform.BuildingBlocks.Domain.Entities;

public interface ISoftDeletable
{
    DateTime? DeletedAt { get; }
    bool IsDeleted { get; }
    void Delete();
    void Restore();
}
