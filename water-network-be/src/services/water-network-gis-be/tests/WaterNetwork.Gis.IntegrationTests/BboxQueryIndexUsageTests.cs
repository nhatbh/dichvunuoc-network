using Dapper;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class BboxQueryIndexUsageTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static async Task<string> ExplainAsync(NpgsqlConnection conn, string table, string geomCol)
    {
        // Force the planner away from seq scan so it MUST use the GiST index if the
        // index is applicable to the && bbox predicate. The plan text then names it.
        await conn.ExecuteAsync("SET enable_seqscan = off;");
        var plan = await conn.QueryAsync<string>(
            $"""
             EXPLAIN
             SELECT id FROM {table}
             WHERE {geomCol} && ST_MakeEnvelope(106.6, 10.7, 106.7, 10.8, 4326)
             """);
        return string.Join("\n", plan);
    }

    [Theory]
    [InlineData("network_nodes", "location", "ix_network_nodes_location_gist")]
    [InlineData("network_pipes", "geometry", "ix_network_pipes_geometry_gist")]
    [InlineData("network_devices", "location", "ix_network_devices_location_gist")]
    public async Task Bbox_Predicate_Uses_Gist_Index(string table, string geomCol, string indexName)
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var conn = (NpgsqlConnection)dbContext.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open)
            await conn.OpenAsync();

        var plan = await ExplainAsync(conn, table, geomCol);

        plan.Should().Contain(indexName,
            $"the && bbox predicate on {table}.{geomCol} must be served by the {indexName} GiST index");
    }
}
