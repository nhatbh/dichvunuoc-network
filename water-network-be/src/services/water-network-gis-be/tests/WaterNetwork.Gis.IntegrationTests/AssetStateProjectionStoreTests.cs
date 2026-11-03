using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class AssetStateProjectionStoreTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static async Task<(GisApiFactory f, IServiceScope s)> BootAsync(PostgisFixture postgis)
    {
        var f = new GisApiFactory(postgis);
        var s = f.Services.CreateScope();
        return await Task.FromResult((f, s));
    }

    [Fact]
    public async Task Upsert_Inserts_Then_Updates_With_Newer_OccurredAt()
    {
        var (f, scope) = await BootAsync(postgis);
        await using var _ = f; using var __ = scope;
        var store = scope.ServiceProvider.GetRequiredService<IAssetStateProjectionStore>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var id = $"asset-{Guid.NewGuid():N}";
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        await store.UpsertAsync(id, "tenant-1", "Active", t0, "evt-1");
        await store.UpsertAsync(id, "tenant-1", "Suspended", t0.AddMinutes(5), "evt-2");

        var row = await db.NetworkAssetStates.FindAsync(id);
        row!.LifecycleStatus.Should().Be("Suspended");
        row.LastEventId.Should().Be("evt-2");
    }

    [Fact]
    public async Task Upsert_With_Older_OccurredAt_Does_Not_Regress()
    {
        var (f, scope) = await BootAsync(postgis);
        await using var _ = f; using var __ = scope;
        var store = scope.ServiceProvider.GetRequiredService<IAssetStateProjectionStore>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var id = $"asset-{Guid.NewGuid():N}";
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        await store.UpsertAsync(id, "tenant-1", "Suspended", t0.AddMinutes(5), "evt-new");
        await store.UpsertAsync(id, "tenant-1", "Active", t0, "evt-old"); // older — must be ignored

        var row = await db.NetworkAssetStates.FindAsync(id);
        row!.LifecycleStatus.Should().Be("Suspended", "an older event must not regress the projection");
        row.LastEventId.Should().Be("evt-new");
    }

    [Fact]
    public async Task TenantLookup_Returns_Tenant_For_Registered_Node()
    {
        await using var f = new GisApiFactory(postgis);
        var client = f.CreateClient();
        var token = WaterPlatform.BuildingBlocks.Security.DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new WaterPlatform.BuildingBlocks.Security.JwtOptions(),
            subject: "u", tenantId: "tenant-lookup",
            authorizedParty: "water-network-gis-fe", permissions: ["network-gis:write"]);
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var resp = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = 10.76, longitude = 106.66
        });
        resp.EnsureSuccessStatusCode();
        var nodeId = (await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("id").GetString()!;

        using var scope = f.Services.CreateScope();
        var dao = scope.ServiceProvider.GetRequiredService<IAssetTenantLookupDao>();

        (await dao.GetTenantAsync(nodeId, "Node")).Should().Be("tenant-lookup");
        (await dao.GetTenantAsync($"missing-{Guid.NewGuid():N}", "Node")).Should().BeNull();
    }
}
