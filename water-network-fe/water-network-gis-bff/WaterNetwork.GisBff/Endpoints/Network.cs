// WaterNetwork.GisBff/Endpoints/Network.cs
using System.Text.Json;
using WaterNetwork.GisBff.Seed;
namespace WaterNetwork.GisBff.Endpoints;

public static class Network
{
    public static void Map(WebApplication app) =>
        app.MapGet("/api/gis/network", (SeedStore s, string? layers) =>
        {
            JsonElement net = s.Get("network");
            if (string.IsNullOrWhiteSpace(layers)) return Results.Json(net);
            var want = layers.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var dict = new Dictionary<string, JsonElement>();
            foreach (var k in want)
                if (net.TryGetProperty(k, out var fc)) dict[k] = fc;
            return Results.Json(dict);
        });
}
