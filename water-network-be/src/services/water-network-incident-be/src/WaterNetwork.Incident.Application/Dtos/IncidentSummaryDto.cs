namespace WaterNetwork.Incident.Application.Dtos;

public sealed record IncidentSummaryDto(
    string Id, string Category, int Severity, string Status, string ReportedBy,
    DateTime CreatedAt, DateTime UpdatedAt);
