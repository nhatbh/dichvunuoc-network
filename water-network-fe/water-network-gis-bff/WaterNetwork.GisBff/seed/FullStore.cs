// WaterNetwork.GisBff/Seed/FullStore.cs
// Loads the FULL design dataset (raw pixel-coord window.GIS shape) that the
// FE viewer (Dashboard / SVG NetworkMap) consumes directly. Kept separate from
// SeedStore so the GeoJSON-flavoured /dashboard|/layers|/network endpoints are
// untouched.
using System.Text.Json;
namespace WaterNetwork.GisBff.Seed;

public sealed class FullStore
{
    public JsonElement Root { get; }
    public FullStore(IWebHostEnvironment env)
    {
        var path = Path.Combine(env.ContentRootPath, "seed", "gis-full.json");
        Root = JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone();
    }
}
