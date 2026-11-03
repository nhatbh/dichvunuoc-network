using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record CreateDesignRevisionCommand(string ProjectId) : ICommand<string>;
