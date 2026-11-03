// WaterNetwork.GisBff/Endpoints/Full.cs
// GET /api/gis/full — the complete design dataset (raw window.GIS shape) for the
// FE viewer screens (Dashboard + SVG NetworkMap). Fetched once at app load.
using WaterNetwork.GisBff.Seed;
namespace WaterNetwork.GisBff.Endpoints;

public static class Full
{
    public static void Map(WebApplication app) =>
        app.MapGet("/api/gis/full", (FullStore s) => Results.Json(s.Root));
}
