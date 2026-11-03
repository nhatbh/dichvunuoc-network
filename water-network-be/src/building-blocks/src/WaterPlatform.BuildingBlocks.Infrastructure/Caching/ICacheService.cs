namespace WaterPlatform.BuildingBlocks.Infrastructure.Caching;

public interface ICacheService
{
    Task<T?> GetAsync<T>(string key, CancellationToken ct = default);
    Task SetAsync<T>(string key, T value, TimeSpan? ttl = null, CancellationToken ct = default);
    Task DeleteAsync(string key, CancellationToken ct = default);
    Task<bool> ExistsAsync(string key, CancellationToken ct = default);
    Task<IReadOnlyList<T?>> GetMultipleAsync<T>(IReadOnlyList<string> keys, CancellationToken ct = default);
    Task SetMultipleAsync<T>(IReadOnlyList<(string Key, T Value, TimeSpan? Ttl)> entries, CancellationToken ct = default);
    Task DeleteMultipleAsync(IReadOnlyList<string> keys, CancellationToken ct = default);
    Task<long> IncrementAsync(string key, long by = 1, CancellationToken ct = default);
    Task<long> DecrementAsync(string key, long by = 1, CancellationToken ct = default);
    Task<TimeSpan?> GetTtlAsync(string key, CancellationToken ct = default);
    Task ClearAsync(CancellationToken ct = default);
}
