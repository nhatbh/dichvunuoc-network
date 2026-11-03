// WaterNetwork.GisBff.Tests/FullTests.cs
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
namespace WaterNetwork.GisBff.Tests;

public class FullTests(WebApplicationFactory<Program> f) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Full_returns_complete_design_dataset()
    {
        var json = await f.CreateClient().GetStringAsync("/api/gis/full");
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // Spot-check the raw window.GIS shape the FE viewer consumes.
        Assert.True(root.GetProperty("pipes").GetArrayLength() > 0);
        Assert.Equal(JsonValueKind.Array, root.GetProperty("valves").ValueKind);
        Assert.True(root.GetProperty("dmas").GetArrayLength() > 0);
        Assert.True(root.GetProperty("DASH").GetProperty("pipeKm").GetDouble() > 0);
        Assert.True(root.GetProperty("world").GetProperty("w").GetInt32() > 0);
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("SRID").GetString()));
    }
}
