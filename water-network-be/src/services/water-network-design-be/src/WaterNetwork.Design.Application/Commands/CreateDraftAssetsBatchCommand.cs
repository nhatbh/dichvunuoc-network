// CreateDraftAssetsBatchCommand.cs
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record CreateDraftAssetsBatchCommand(string RevisionId, IReadOnlyList<DraftAssetInput> Assets)
    : ICommand<IReadOnlyList<string>>;
