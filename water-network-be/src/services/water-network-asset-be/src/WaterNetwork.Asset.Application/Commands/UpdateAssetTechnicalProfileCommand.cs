using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Asset.Application.Commands;

public sealed record UpdateAssetTechnicalProfileCommand(
    string AssetId,
    int? InstallationYear,
    string? Manufacturer,
    string? Model,
    IReadOnlyDictionary<string, string?> Attributes) : ICommand<string>;
