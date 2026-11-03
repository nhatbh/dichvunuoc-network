using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RemoveNodeCommand(string NodeId) : ICommand<Unit>;
