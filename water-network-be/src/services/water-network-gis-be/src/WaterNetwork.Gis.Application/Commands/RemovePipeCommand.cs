using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RemovePipeCommand(string PipeId) : ICommand<Unit>;
