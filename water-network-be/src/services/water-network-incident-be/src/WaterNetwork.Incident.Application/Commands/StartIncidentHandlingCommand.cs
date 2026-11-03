using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record StartIncidentHandlingCommand(string IncidentId, string? Note) : ICommand;
