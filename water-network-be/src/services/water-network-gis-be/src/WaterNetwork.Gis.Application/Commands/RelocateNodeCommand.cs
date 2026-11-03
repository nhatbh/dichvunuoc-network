using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RelocateNodeCommand(
    string NodeId,
    double Latitude,
    double Longitude,
    string? Reason) : ICommand<string>;
