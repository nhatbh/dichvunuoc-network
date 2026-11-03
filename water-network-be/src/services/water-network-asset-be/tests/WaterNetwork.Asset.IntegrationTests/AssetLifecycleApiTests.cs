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

public class AssetLifecycleApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private const string TestTenantId = "tenant-001";

    private static HttpClient CreateAuthenticatedClient(AssetApiFactory factory, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "test-user", tenantId: TestTenantId, permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> SeedAssetAsync(AssetApiFactory factory, string? id = null)
    {
        var assetId = id ?? $"node-{Guid.CreateVersion7():N}";
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var asset = NetworkAsset.RegisterFromGis(assetId, TestTenantId, AssetType.Node, $"ND-{assetId[^8..]}");
        await repo.SaveAsync(asset);
        return assetId;
    }

    // 1. Suspend → GET returns Suspended with 2 lifecycle entries
    [Fact]
    public async Task Suspend_Then_Get_Returns_Suspended_With_Two_Lifecycle_Entries()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-asset:write", "network-asset:read");
        var id = await SeedAssetAsync(factory);

        var suspendResp = await client.PostAsync($"/api/assets/{id}/suspend", null);
        suspendResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var getResp = await client.GetAsync($"/api/assets/{id}");
        getResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var detail = await getResp.Content.ReadFromJsonAsync<AssetDetailDto>();
        detail.Should().NotBeNull();
        detail!.Status.Should().Be("Suspended");
        detail.LifecycleHistory.Should().HaveCount(2, "Registered→Active on creation, Active→Suspended now");
    }

    // 2. Double-suspend → 422 with "InvalidAssetTransition"
    [Fact]
    public async Task Suspend_Again_Returns_422_InvalidAssetTransition()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-asset:write");
        var id = await SeedAssetAsync(factory);

        await client.PostAsync($"/api/assets/{id}/suspend", null);
        var secondSuspend = await client.PostAsync($"/api/assets/{id}/suspend", null);

        secondSuspend.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var body = await secondSuspend.Content.ReadAsStringAsync();
        body.Should().Contain("InvalidAssetTransition");
    }

    // 3. Decommission then activate → 422 AssetAlreadyDecommissioned
    [Fact]
    public async Task Decommission_Then_Activate_Returns_422_AssetAlreadyDecommissioned()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-asset:write");
        var id = await SeedAssetAsync(factory);

        var decommResp = await client.PostAsJsonAsync($"/api/assets/{id}/decommission",
            new { reason = "end-of-life" });
        decommResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var activateResp = await client.PostAsync($"/api/assets/{id}/activate", null);
        activateResp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var body = await activateResp.Content.ReadAsStringAsync();
        body.Should().Contain("AssetAlreadyDecommissioned");
    }

    // 4. UpdateTechnicalProfile → GET shows profile
    [Fact]
    public async Task Update_TechnicalProfile_Then_Get_Returns_Profile()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-asset:write", "network-asset:read");
        var id = await SeedAssetAsync(factory);

        var putResp = await client.PutAsJsonAsync($"/api/assets/{id}/technical-profile", new
        {
            installationYear = 2019,
            manufacturer = "Acme",
            model = "V-200",
            attributes = new Dictionary<string, string?> { ["pressureRating"] = "PN16" }
        });
        putResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var getResp = await client.GetAsync($"/api/assets/{id}");
        getResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var detail = await getResp.Content.ReadFromJsonAsync<AssetDetailDto>();
        detail!.TechnicalProfile.Should().NotBeNull();
        detail.TechnicalProfile!.InstallationYear.Should().Be(2019);
        detail.TechnicalProfile.Manufacturer.Should().Be("Acme");
        detail.TechnicalProfile.Attributes["pressureRating"].Should().Be("PN16");
    }

    // 5. List by status returns the suspended asset
    [Fact]
    public async Task List_ByStatus_Contains_The_Suspended_Asset()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-asset:write", "network-asset:read");
        var id = await SeedAssetAsync(factory);

        await client.PostAsync($"/api/assets/{id}/suspend", null);

        var listResp = await client.GetAsync("/api/assets?status=Suspended&page=1&pageSize=20");
        listResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await listResp.Content.ReadFromJsonAsync<AssetPagedResult>();
        result.Should().NotBeNull();
        result!.Data.Should().Contain(d => d.Id == id);
    }

    // 5b. List with oversized pageSize is capped at 200
    [Fact]
    public async Task List_OversizedPageSize_IsCappedAt200()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-asset:read");

        var listResp = await client.GetAsync("/api/assets?pageSize=100000");
        listResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await listResp.Content.ReadFromJsonAsync<AssetPagedResult>();
        result.Should().NotBeNull();
        result!.PageSize.Should().Be(200);
    }

    // 6. GET unknown asset → 404
    [Fact]
    public async Task Get_Unknown_Asset_Returns_404()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-asset:read");

        var resp = await client.GetAsync($"/api/assets/asset-does-not-exist-{Guid.NewGuid():N}");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // 7a. No token → 401
    [Fact]
    public async Task No_Token_Returns_401()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = factory.CreateClient();
        var id = await SeedAssetAsync(factory);

        var resp = await client.PostAsync($"/api/assets/{id}/suspend", null);
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // 7b. Wrong permission → 403
    [Fact]
    public async Task Wrong_Permission_Returns_403()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-asset:read"); // missing write
        var id = await SeedAssetAsync(factory);

        var resp = await client.PostAsync($"/api/assets/{id}/suspend", null);
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}
