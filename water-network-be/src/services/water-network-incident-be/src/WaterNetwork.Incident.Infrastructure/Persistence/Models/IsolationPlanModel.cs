namespace WaterNetwork.Incident.Infrastructure.Persistence.Models;

public sealed class IsolationPlanModel
{
    public string Id { get; set; } = default!;
    public string IncidentId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string StartNodeId { get; set; } = default!;
    public string Status { get; set; } = default!;
    public long GraphVersion { get; set; }
    public List<string> ValvesToClose { get; set; } = [];
    public List<string> IsolatedNodes { get; set; } = [];
    public List<string> IsolatedPipes { get; set; } = [];
    public string? FailureReason { get; set; }
    public DateTime ComputedAt { get; set; }
    public int Sequence { get; set; }
}
