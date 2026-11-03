namespace WaterNetwork.Incident.Domain.ValueObjects;

// INC-1 subset + INC-2 isolation states (decisions 0021, 0023). INC-3 extends further.
public enum IncidentStatus
{
    Reported,
    Classified,
    Cancelled,
    IsolationRequested,
    IsolationPlanReady,
    IsolationConfirmed,
    InProgress,
    Resolved
}
