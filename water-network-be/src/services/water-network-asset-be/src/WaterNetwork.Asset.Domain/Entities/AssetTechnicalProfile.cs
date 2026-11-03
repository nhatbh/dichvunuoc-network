namespace WaterNetwork.Asset.Domain.Entities;

/// <summary>1-1 technical profile: a few hard fields + loose key-value attributes (persisted as jsonb).</summary>
public sealed class AssetTechnicalProfile
{
    public int? InstallationYear { get; }
    public string? Manufacturer { get; }
    public string? Model { get; }
    public IReadOnlyDictionary<string, string?> Attributes { get; }

    public AssetTechnicalProfile(int? installationYear, string? manufacturer, string? model,
        IReadOnlyDictionary<string, string?> attributes)
    {
        InstallationYear = installationYear;
        Manufacturer = manufacturer;
        Model = model;
        // Defensive copy: honour the IReadOnlyDictionary immutability contract even if the
        // caller retains a reference to the source dictionary and mutates it afterward.
        Attributes = new Dictionary<string, string?>(attributes);
    }
}
