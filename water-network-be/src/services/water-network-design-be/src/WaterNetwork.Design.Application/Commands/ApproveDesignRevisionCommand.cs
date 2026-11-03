using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record ApproveDesignRevisionCommand(string RevisionId, string? Reason) : ICommand<Unit>;
