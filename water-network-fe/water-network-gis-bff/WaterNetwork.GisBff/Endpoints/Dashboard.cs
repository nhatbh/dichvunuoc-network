// WaterNetwork.GisBff/Endpoints/Dashboard.cs
using WaterNetwork.GisBff.Seed;
namespace WaterNetwork.GisBff.Endpoints;

public static class Dashboard
{
    public static void Map(WebApplication app) =>
        app.MapGet("/api/gis/dashboard", (SeedStore s) => Results.Json(s.Get("dashboard")));
}
