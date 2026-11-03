using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record ClassifyIncidentCommand(
    string IncidentId, IncidentCategory Category, int Severity, string? Note) : ICommand;
