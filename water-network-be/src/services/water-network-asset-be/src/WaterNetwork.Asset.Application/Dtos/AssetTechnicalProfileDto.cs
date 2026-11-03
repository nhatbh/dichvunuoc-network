namespace WaterNetwork.Asset.Application.Dtos;

public sealed record AssetTechnicalProfileDto(
    int? InstallationYear,
    string? Manufacturer,
    string? Model,
    IReadOnlyDictionary<string, string?> Attributes);
