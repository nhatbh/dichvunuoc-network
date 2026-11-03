namespace WaterNetwork.Incident.Domain.ValueObjects;

// INC-2 subset (decision 0023). INC-3 adds Confirmed.
public enum IsolationPlanStatus
{
    Proposed,
    AnalysisFailed,
    Superseded,
    Confirmed
}
