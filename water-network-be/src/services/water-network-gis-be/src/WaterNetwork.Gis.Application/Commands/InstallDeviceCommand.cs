using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record InstallDeviceCommand(
    string AssetCode,
    string ComponentCode,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude,
    IReadOnlyDictionary<string, string>? Properties = null) : ICommand<string>;
