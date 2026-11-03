using Dapper;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence.Sql;

/// <summary>
/// Dapper-backed read access for hand-written SQL (multi-table joins, reports, spatial bbox queries).
/// Use for read paths that are awkward or inefficient with EF Include graphs.
/// </summary>
public sealed class SqlReadDao : IReadDao
{
    private readonly string _connectionString;

    public SqlReadDao(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("PostgreSQL")
            ?? throw new InvalidOperationException("Connection string 'PostgreSQL' is not configured.");
    }

    public async Task<IReadOnlyList<T>> ExecuteQueryAsync<T>(string sql, object? param = null, CancellationToken ct = default)
    {
        await using var connection = CreateConnection();
        await connection.OpenAsync(ct);
        var rows = await connection.QueryAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct));
        return rows.AsList();
    }

    public async Task<T?> ExecuteQueryOneAsync<T>(string sql, object? param = null, CancellationToken ct = default)
    {
        await using var connection = CreateConnection();
        await connection.OpenAsync(ct);
        return await connection.QueryFirstOrDefaultAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<long> ExecuteCountAsync(string sql, object? param = null, CancellationToken ct = default)
    {
        await using var connection = CreateConnection();
        await connection.OpenAsync(ct);
        return await connection.ExecuteScalarAsync<long>(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    private NpgsqlConnection CreateConnection() => new(_connectionString);
}
