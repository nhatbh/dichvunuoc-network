using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record ConfirmIsolationPlanCommand(string IncidentId, string? Note) : ICommand;
