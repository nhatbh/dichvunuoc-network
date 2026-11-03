// WaterNetwork.GisBff/Endpoints/Layers.cs
using WaterNetwork.GisBff.Seed;
namespace WaterNetwork.GisBff.Endpoints;

public static class Layers
{
    public static void Map(WebApplication app) =>
        app.MapGet("/api/gis/layers", (SeedStore s) => Results.Json(s.Get("layers")));
}
