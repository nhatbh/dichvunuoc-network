namespace WaterNetwork.Bff.Api.Configuration;

public sealed class AppEntitlementOptions
{
    public const string SectionName = "AppEntitlement";

    /// <summary>
    /// False skips the app-catalog gate (decision 0031): a dev/staging escape hatch while the
    /// catalog has no record for the app. Refused in Production. Token and permission checks stay.
    /// </summary>
    public bool Enabled { get; set; } = true;
    public string BaseUrl { get; set; } = "";
    public string AppCode { get; set; } = "ml-0";
    public int CacheTtlSeconds { get; set; } = 5;
}
