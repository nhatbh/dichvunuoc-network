namespace WaterNetwork.Incident.Contracts;

public static class IncidentEventTypes
{
    public const string Reported = "incident.reported";
    public const string Classified = "incident.classified";
    public const string Cancelled = "incident.cancelled";
    public const string IsolationPlanCreated = "incident.isolation-plan-created";
    public const string IsolationPlanConfirmed = "incident.isolation-plan-confirmed";
    public const string Resolved = "incident.resolved";
    // Phase 4 work-order contract, produced by incident-be (frozen v1).
    public const string WorkOrderRequested = "maintenance.work-order-requested";
}
