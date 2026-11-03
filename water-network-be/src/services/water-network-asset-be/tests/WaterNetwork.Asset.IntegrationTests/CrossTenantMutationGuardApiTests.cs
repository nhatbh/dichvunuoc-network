using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Application.Dtos;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Asset.IntegrationTests;

public class CrossTenantMutationGuardApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static readonly string[] WriteReadPermissions = { "network-asset:write", "network-asset:read" };

    private static HttpClient ClientFor(AssetApiFactory factory, string tenantId)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "test-user", tenantId: tenantId, permissions: WriteReadPermissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> SeedAssetAsync(AssetApiFactory factory, string tenantId)
    {
        var id = $"node-{Guid.CreateVersion7():N}";
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var asset = NetworkAsset.RegisterFromGis(id, tenantId, AssetType.Node, $"ND-{id[^8..]}");
        await repo.SaveAsync(asset);
        return id;
    }

    [Fact]
    public async Task Tenant_B_Cannot_Mutate_Tenant_A_Asset()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var tenantA = ClientFor(factory, "tenant-A");
        using var tenantB = ClientFor(factory, "tenant-B");

        var id = await SeedAssetAsync(factory, "tenant-A");

        // Every tenant-B mutation → 404.
        (await tenantB.PostAsync($"/api/assets/{id}/suspend", null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await tenantB.PostAsJsonAsync($"/api/assets/{id}/decommission", new { reason = "x" }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await tenantB.PutAsJsonAsync($"/api/assets/{id}/technical-profile",
            new { installationYear = 2000, manufacturer = "X", model = "Y", attributes = new Dictionary<string, string?>() }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        // Unchanged: tenant A still sees the asset as Active with only the creation entry.
        var getA = await tenantA.GetAsync($"/api/assets/{id}");
        getA.StatusCode.Should().Be(HttpStatusCode.OK);
        var detail = await getA.Content.ReadFromJsonAsync<AssetDetailDto>();
        detail!.Status.Should().Be("Active");
        detail.LifecycleHistory.Should().HaveCount(1, "only Registered→Active from creation; no tenant-B mutation applied");

        // Control: tenant A (owner) can suspend its own asset.
        (await tenantA.PostAsync($"/api/assets/{id}/suspend", null)).StatusCode.Should().Be(HttpStatusCode.NoContent);
    }
}
