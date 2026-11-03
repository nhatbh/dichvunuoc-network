using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RegisterPipeCommand(
    string AssetCode,
    string FromNodeId,
    string ToNodeId,
    IReadOnlyList<(double Lat, double Lng)> Points,
    double DiameterMm,
    string Material,
    double? LengthM) : ICommand<string>;
