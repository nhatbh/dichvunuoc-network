using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record ResolveIncidentCommand(string IncidentId, string? ResolutionNote) : ICommand;
