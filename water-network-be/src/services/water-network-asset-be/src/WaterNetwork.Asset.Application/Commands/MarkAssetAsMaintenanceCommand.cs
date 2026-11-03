using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Asset.Application.Commands;

public sealed record MarkAssetAsMaintenanceCommand(string AssetId, string? Reason) : ICommand<string>;
