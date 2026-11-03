namespace WaterPlatform.BuildingBlocks.Domain.Services;

public interface IUniquenessChecker
{
    Task<bool> IsUniqueAsync(string field, string value, string? excludeId = null, CancellationToken ct = default);
}
