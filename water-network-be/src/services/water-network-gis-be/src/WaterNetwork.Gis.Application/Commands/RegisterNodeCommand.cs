using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RegisterNodeCommand(
    string AssetCode, string NodeType, double Latitude, double Longitude) : ICommand<string>;
