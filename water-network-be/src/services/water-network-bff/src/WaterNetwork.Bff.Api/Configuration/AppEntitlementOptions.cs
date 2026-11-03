namespace WaterNetwork.Bff.Api.Configuration;

public sealed class AppEntitlementOptions
{
    public const string SectionName = "AppEntitlement";

    public string BaseUrl { get; set; } = "";
    public string AppCode { get; set; } = "ml-0";
    public int CacheTtlSeconds { get; set; } = 5;
}
