// WaterNetwork.GisBff.Tests/LayersTests.cs
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
namespace WaterNetwork.GisBff.Tests;

public class LayersTests(WebApplicationFactory<Program> f) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Layers_includes_pipe_layer()
    {
        var json = await f.CreateClient().GetStringAsync("/api/gis/layers");
        using var doc = JsonDocument.Parse(json);
        var ids = new List<string?>();
        foreach (var l in doc.RootElement.EnumerateArray()) ids.Add(l.GetProperty("id").GetString());
        Assert.Contains("pipe", ids);
    }
}
