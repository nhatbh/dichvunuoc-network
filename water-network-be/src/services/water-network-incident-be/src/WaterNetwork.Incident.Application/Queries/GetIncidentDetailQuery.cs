using WaterNetwork.Incident.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Incident.Application.Queries;

public sealed record GetIncidentDetailQuery(string IncidentId) : IQuery<IncidentDetailDto?>;
