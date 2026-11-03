namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public interface IReadDao
{
    Task<IReadOnlyList<T>> ExecuteQueryAsync<T>(string sql, object? param = null, CancellationToken ct = default);
    Task<T?> ExecuteQueryOneAsync<T>(string sql, object? param = null, CancellationToken ct = default);
    Task<long> ExecuteCountAsync(string sql, object? param = null, CancellationToken ct = default);
}
