namespace WaterNetwork.GisBff.Endpoints;

public static class Health
{
    public static void Map(WebApplication app) =>
        app.MapGet("/api/gis/ping", () => Results.Ok(new { status = "ok" }));
}
