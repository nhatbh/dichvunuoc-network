using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record CreateDesignProjectCommand(string Name, string? BranchId, string? ZoneId) : ICommand<string>;
