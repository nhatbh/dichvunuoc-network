namespace WaterNetwork.Gis.Application.Configuration;

/// <summary>
/// Bound from the "GisQuery:Bbox" config section. Caps the queryable bbox area to
/// block full-table scans from a fully zoomed-out client, and the page size.
/// </summary>
public sealed class BboxQueryOptions
{
    public const string SectionName = "GisQuery:Bbox";

    public double MaxAreaSquareDegrees { get; set; } = 1.0;
    public int DefaultLimit { get; set; } = 2000;
    public int MaxLimit { get; set; } = 10000;
}
