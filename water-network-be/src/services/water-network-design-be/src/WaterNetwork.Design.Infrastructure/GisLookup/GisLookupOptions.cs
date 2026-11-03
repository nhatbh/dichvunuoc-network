namespace WaterNetwork.Design.Infrastructure.GisLookup;

public sealed class GisLookupOptions
{
    public const string SectionName = "GisLookup";

    public string Provider { get; set; } = "Stub";
    public string BaseUrl { get; set; } = "http://water-network-gis-be:8080";
    /// <summary>Asset codes the stub treats as already existing in GIS (for tests/demo).</summary>
    public string[] ExistingCodes { get; set; } = Array.Empty<string>();
}
