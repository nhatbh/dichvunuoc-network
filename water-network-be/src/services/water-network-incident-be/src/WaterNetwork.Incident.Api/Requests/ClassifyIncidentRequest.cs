using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Api.Requests;

public sealed record ClassifyIncidentRequest(IncidentCategory Category, int Severity, string? Note);
