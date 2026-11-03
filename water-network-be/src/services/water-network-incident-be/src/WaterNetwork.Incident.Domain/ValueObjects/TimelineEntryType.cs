namespace WaterNetwork.Incident.Domain.ValueObjects;

// INC-1 + INC-2 isolation timeline entries (decisions 0021, 0023). INC-3 extends further.
public enum TimelineEntryType
{
    Reported,
    Classified,
    Cancelled,
    IsolationRequested,
    IsolationPlanReady,
    AnalysisFailed,
    IsolationConfirmed,
    HandlingStarted,
    Resolved
}
