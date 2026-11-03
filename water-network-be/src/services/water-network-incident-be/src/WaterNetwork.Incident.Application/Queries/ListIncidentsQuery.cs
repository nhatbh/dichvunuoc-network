using WaterNetwork.Incident.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Incident.Application.Queries;

public sealed record ListIncidentsQuery(string? Status, int? Severity) : IQuery<IReadOnlyList<IncidentSummaryDto>>;
