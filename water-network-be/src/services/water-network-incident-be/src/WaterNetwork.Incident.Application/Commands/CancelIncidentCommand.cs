using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record CancelIncidentCommand(string IncidentId, string Reason) : ICommand;
