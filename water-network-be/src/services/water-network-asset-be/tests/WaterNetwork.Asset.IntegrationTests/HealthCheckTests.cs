using System.Net;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public class HealthCheckTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task Health_Endpoint_Returns_Ok()
    {
        await using var factory = new AssetApiFactory(postgis);
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
