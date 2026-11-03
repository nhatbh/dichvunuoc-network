using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
namespace WaterNetwork.GisBff.Tests;

public class HealthTests(WebApplicationFactory<Program> f) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Ping_returns_ok()
    {
        var res = await f.CreateClient().GetAsync("/api/gis/ping");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("ok", await res.Content.ReadAsStringAsync());
    }
}
