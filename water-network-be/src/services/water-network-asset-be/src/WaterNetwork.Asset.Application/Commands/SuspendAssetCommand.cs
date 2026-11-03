using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Asset.Application.Commands;

public sealed record SuspendAssetCommand(string AssetId, string? Reason) : ICommand<string>;
