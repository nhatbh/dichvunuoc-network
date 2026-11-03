using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record RejectDesignRevisionCommand(string RevisionId, string Reason) : ICommand<Unit>;
