using WaterNetwork.Gis.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Gis.Application.Queries;

public sealed record GetNodeGeometryHistoryQuery(string NodeId) : IQuery<IReadOnlyList<GeometryVersionDto>>;
