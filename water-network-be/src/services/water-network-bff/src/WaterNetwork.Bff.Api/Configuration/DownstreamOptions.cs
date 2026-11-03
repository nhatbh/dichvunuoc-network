namespace WaterNetwork.Bff.Api.Configuration;

public sealed class DownstreamOptions
{
    public const string SectionName = "Downstream";
    public DownstreamEndpoint Gis { get; set; } = new();
    public DownstreamEndpoint Asset { get; set; } = new();
    // Optional: an unconfigured CAD import service fails closed at the endpoint.
    public DownstreamEndpoint Design { get; set; } = new();
    public DownstreamEndpoint Import { get; set; } = new();
}

public sealed class DownstreamEndpoint
{
    public string BaseUrl { get; set; } = "";
}

public static class DownstreamOptionsValidation
{
    public static bool IsAbsoluteHttpUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme is "http" or "https";
}
