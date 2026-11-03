namespace WaterNetwork.Asset.Contracts.Requests;

public sealed record UpdateAssetTechnicalProfileRequest(
    int? InstallationYear,
    string? Manufacturer,
    string? Model,
    Dictionary<string, string?>? Attributes);
