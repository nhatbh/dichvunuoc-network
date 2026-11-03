using WaterNetwork.Incident.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record RequestIsolationAnalysisCommand(string IncidentId, string StartNodeId)
    : ICommand<IsolationAnalysisResultDto>;
