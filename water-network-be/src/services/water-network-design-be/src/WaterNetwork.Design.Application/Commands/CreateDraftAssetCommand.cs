// CreateDraftAssetCommand.cs
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record CreateDraftAssetCommand(string RevisionId, DraftAssetInput Asset) : ICommand<string>;
