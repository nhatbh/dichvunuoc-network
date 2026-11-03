// WaterNetwork.GisBff/Seed/SeedStore.cs
using System.Text.Json;
namespace WaterNetwork.GisBff.Seed;

public sealed class SeedStore
{
    public JsonElement Root { get; }
    public SeedStore(IWebHostEnvironment env)
    {
        var path = Path.Combine(env.ContentRootPath, "seed", "gis-seed.json");
        Root = JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone();
    }
    public JsonElement Get(string prop) => Root.GetProperty(prop);
}
