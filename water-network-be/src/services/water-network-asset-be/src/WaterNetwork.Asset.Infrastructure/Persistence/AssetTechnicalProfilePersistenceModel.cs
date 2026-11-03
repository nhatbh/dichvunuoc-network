namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class AssetTechnicalProfilePersistenceModel
{
    public string AssetId { get; set; } = default!;   // PK + FK (1-1)
    public int? InstallationYear { get; set; }
    public string? Manufacturer { get; set; }
    public string? Model { get; set; }
    public string AttributesJson { get; set; } = "{}"; // jsonb-serialized Dictionary<string,string?>
}
