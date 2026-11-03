// WaterNetwork.GisBff.Tests/NetworkTests.cs
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
namespace WaterNetwork.GisBff.Tests;

public class NetworkTests(WebApplicationFactory<Program> f) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Network_returns_pipe_featurecollection_in_4326()
    {
        var json = await f.CreateClient().GetStringAsync("/api/gis/network");
        using var doc = JsonDocument.Parse(json);
        var pipe = doc.RootElement.GetProperty("pipe");
        Assert.Equal("FeatureCollection", pipe.GetProperty("type").GetString());
        var first = pipe.GetProperty("features")[0];
        var coords = first.GetProperty("geometry").GetProperty("coordinates")[0];
        var lon = coords[0].GetDouble();
        Assert.InRange(lon, 105.0, 107.0); // đã transform sang 4326
    }

    [Fact]
    public async Task Network_layers_filter_returns_only_requested()
    {
        var json = await f.CreateClient().GetStringAsync("/api/gis/network?layers=valve");
        using var doc = JsonDocument.Parse(json);
        Assert.True(doc.RootElement.TryGetProperty("valve", out _));
        Assert.False(doc.RootElement.TryGetProperty("pipe", out _));
    }
}
