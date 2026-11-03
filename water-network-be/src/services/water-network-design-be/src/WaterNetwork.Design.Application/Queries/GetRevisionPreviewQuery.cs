using WaterNetwork.Design.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Design.Application.Queries;

public sealed record GetRevisionPreviewQuery(string RevisionId) : IQuery<IReadOnlyList<DraftAssetPreviewDto>?>;
