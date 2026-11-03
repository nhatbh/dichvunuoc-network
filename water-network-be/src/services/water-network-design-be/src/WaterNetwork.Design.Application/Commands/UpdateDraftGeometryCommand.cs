using WaterNetwork.Design.Application.Geometry;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record UpdateDraftGeometryCommand(string DraftAssetId, DraftGeometryInput Geometry) : ICommand<Unit>;
