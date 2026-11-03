// WaterNetwork.GisBff.Tests/DashboardTests.cs
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
namespace WaterNetwork.GisBff.Tests;

public class DashboardTests(WebApplicationFactory<Program> f) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Dashboard_has_positive_pipeKm()
    {
        var json = await f.CreateClient().GetStringAsync("/api/gis/dashboard");
        using var doc = JsonDocument.Parse(json);
        Assert.True(doc.RootElement.GetProperty("pipeKm").GetDouble() > 0);
    }
}
