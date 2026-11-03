using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record SubmitDesignRevisionCommand(string RevisionId) : ICommand<Unit>;
