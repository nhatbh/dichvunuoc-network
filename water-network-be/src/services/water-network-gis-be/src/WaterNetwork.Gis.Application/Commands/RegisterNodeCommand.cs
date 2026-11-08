using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RegisterNodeCommand(
    string AssetCode,
    string ComponentCode,
    double Latitude,
    double Longitude,
    IReadOnlyDictionary<string, string>? Properties = null) : ICommand<string>;
