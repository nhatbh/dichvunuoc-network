using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class DownstreamConfigurationTests
{
    [Fact]
    public void Invalid_Downstream_Url_Fails_Host_Startup()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Downstream:Gis:BaseUrl"] = "not-an-absolute-url",
                })));

        var act = () => factory.CreateClient();

        act.Should().Throw<Exception>().Which.ToString()
            .Should().Contain("Downstream:Gis:BaseUrl must be an absolute HTTP(S) URL");
    }
}
