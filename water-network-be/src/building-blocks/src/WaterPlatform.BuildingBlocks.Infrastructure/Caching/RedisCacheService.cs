using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Caching;

internal sealed class RedisCacheService(IDistributedCache cache) : ICacheService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public async Task<T?> GetAsync<T>(string key, CancellationToken ct = default)
    {
        var bytes = await cache.GetAsync(key, ct);
        if (bytes is null)
        {
            return default;
        }

        return JsonSerializer.Deserialize<T>(bytes, JsonOptions);
    }

    public async Task SetAsync<T>(string key, T value, TimeSpan? ttl = null, CancellationToken ct = default)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        var options = new DistributedCacheEntryOptions();

        if (ttl.HasValue)
        {
            options.AbsoluteExpirationRelativeToNow = ttl;
        }

        await cache.SetAsync(key, bytes, options, ct);
    }

    public async Task DeleteAsync(string key, CancellationToken ct = default)
    {
        await cache.RemoveAsync(key, ct);
    }

    public async Task<bool> ExistsAsync(string key, CancellationToken ct = default)
    {
        var bytes = await cache.GetAsync(key, ct);
        return bytes is not null;
    }

    public async Task<IReadOnlyList<T?>> GetMultipleAsync<T>(IReadOnlyList<string> keys, CancellationToken ct = default)
    {
        var results = new List<T?>(keys.Count);
        foreach (var key in keys)
        {
            results.Add(await GetAsync<T>(key, ct));
        }

        return results.AsReadOnly();
    }

    public async Task SetMultipleAsync<T>(IReadOnlyList<(string Key, T Value, TimeSpan? Ttl)> entries, CancellationToken ct = default)
    {
        foreach (var (key, value, ttl) in entries)
        {
            await SetAsync(key, value, ttl, ct);
        }
    }

    public async Task DeleteMultipleAsync(IReadOnlyList<string> keys, CancellationToken ct = default)
    {
        foreach (var key in keys)
        {
            await DeleteAsync(key, ct);
        }
    }

    /// <remarks>
    /// <strong>Non-atomic read-modify-write.</strong> This implementation reads the current value,
    /// adds <paramref name="by"/>, then writes the result as separate operations over
    /// <see cref="IDistributedCache"/>. Under concurrent callers the increments are NOT
    /// serialised and values can be lost. Use a Redis-native INCR (e.g. via StackExchange.Redis
    /// directly) for true atomic increment.
    /// </remarks>
    public async Task<long> IncrementAsync(string key, long by = 1, CancellationToken ct = default)
    {
        var current = await GetAsync<long>(key, ct);
        var newValue = (current == 0 ? 0 : current) + by;
        await SetAsync(key, newValue, ct: ct);
        return newValue;
    }

    /// <remarks>
    /// <strong>Non-atomic read-modify-write.</strong> This implementation reads the current value,
    /// subtracts <paramref name="by"/>, then writes the result as separate operations over
    /// <see cref="IDistributedCache"/>. Under concurrent callers the decrements are NOT
    /// serialised and values can be lost. Use a Redis-native DECR (e.g. via StackExchange.Redis
    /// directly) for true atomic decrement.
    /// </remarks>
    public async Task<long> DecrementAsync(string key, long by = 1, CancellationToken ct = default)
    {
        var current = await GetAsync<long>(key, ct);
        var newValue = (current == 0 ? 0 : current) - by;
        await SetAsync(key, newValue, ct: ct);
        return newValue;
    }

    /// <remarks>
    /// <strong>Not supported under <see cref="IDistributedCache"/>.</strong> The abstraction does
    /// not expose TTL information; this method always returns <c>null</c>.  To read TTL, access
    /// the underlying StackExchange.Redis <c>IDatabase</c> directly and call
    /// <c>KeyTimeToLiveAsync</c>.
    /// </remarks>
    public async Task<TimeSpan?> GetTtlAsync(string key, CancellationToken ct = default)
    {
        var bytes = await cache.GetAsync(key, ct);
        if (bytes is null)
        {
            return null;
        }

        return null;
    }

    /// <remarks>
    /// <strong>Not supported under <see cref="IDistributedCache"/>.</strong> The abstraction does
    /// not expose a cache-wide clear operation; this method is a no-op.  To flush all keys, use
    /// the StackExchange.Redis <c>IServer.FlushDatabaseAsync</c> directly.
    /// </remarks>
    public async Task ClearAsync(CancellationToken ct = default)
    {
        await Task.CompletedTask;
    }
}
