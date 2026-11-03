using System.Net;
using FluentAssertions;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class HealthCheckTests
{
    [Fact]
    public async Task Health_Endpoint_Returns_200()
    {
        using var factory = new BffApiFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
