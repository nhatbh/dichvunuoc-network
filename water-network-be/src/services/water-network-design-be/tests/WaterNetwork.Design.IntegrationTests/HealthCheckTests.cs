using System.Net;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class HealthCheckTests(PostgisFixture postgis)
{
    [Fact]
    public async Task Health_Endpoint_Returns_200()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
