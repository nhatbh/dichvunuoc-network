namespace WaterNetwork.Incident.Infrastructure.GisLookup;

public sealed class GisLookupOptions
{
    public const string SectionName = "GisLookup";
    public string Provider { get; set; } = "Stub";
    public string BaseUrl { get; set; } = "http://water-network-gis-be:8080";
    /// <summary>Known refs the stub treats as existing, each formatted "Kind:assetId" (e.g. "Pipe:pipe-1").</summary>
    public string[] ExistingRefs { get; set; } = [];
}
