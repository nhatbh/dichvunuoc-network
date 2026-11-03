using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record InstallDeviceCommand(
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude) : ICommand<string>;
