using WaterNetwork.Incident.Domain.DomainEvents;
using WaterNetwork.Incident.Domain.Entities;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Incident.Domain.Aggregates;

public sealed class NetworkIncident : AggregateRoot
{
    private readonly List<AssetRef> _affectedRefs = [];
    private readonly List<IncidentTimelineEntry> _timeline = [];
    private readonly List<IsolationPlan> _isolationPlans = [];

    public string TenantId { get; private set; }
    public IncidentCategory Category { get; private set; }
    public int Severity { get; private set; }
    public double? Longitude { get; private set; }
    public double? Latitude { get; private set; }
    public IncidentStatus Status { get; private set; }
    public string ReportedBy { get; private set; }
    public string? CancellationReason { get; private set; }

    public IReadOnlyList<AssetRef> AffectedRefs => _affectedRefs.AsReadOnly();
    public IReadOnlyList<IncidentTimelineEntry> TimelineEntries => _timeline.AsReadOnly();
    public IReadOnlyList<IsolationPlan> IsolationPlans => _isolationPlans.AsReadOnly();

    private NetworkIncident(
        string id, string tenantId, IncidentCategory category, int severity,
        double? longitude, double? latitude, IncidentStatus status, string reportedBy,
        string? cancellationReason, int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        Category = category;
        Severity = severity;
        Longitude = longitude;
        Latitude = latitude;
        Status = status;
        ReportedBy = reportedBy;
        CancellationReason = cancellationReason;
    }

    public static NetworkIncident Report(
        string tenantId, IncidentCategory category, int severity,
        double? longitude, double? latitude, IReadOnlyList<AssetRef> affectedRefs, string reportedBy)
    {
        GuardSeverity(severity);
        GuardLocation(longitude, latitude);

        var incident = new NetworkIncident(
            Guid.CreateVersion7().ToString(), tenantId, category, severity,
            longitude, latitude, IncidentStatus.Reported, reportedBy, cancellationReason: null);

        incident._affectedRefs.AddRange(affectedRefs);
        incident._timeline.Add(IncidentTimelineEntry.Create(TimelineEntryType.Reported, reportedBy, note: null, sequence: 0));
        incident.MarkAsModified();
        incident.AddDomainEvent(new IncidentReported(incident.Id, new IncidentReportedData(
            tenantId, category.ToString(), severity, longitude, latitude,
            affectedRefs.Select(r => new IncidentReportedAssetRefData(r.AssetId, r.Kind.ToString(), r.Verified)).ToList(),
            reportedBy)));
        return incident;
    }

    public void Classify(IncidentCategory category, int severity, string actorId, string? note)
    {
        if (Status is not (IncidentStatus.Reported or IncidentStatus.Classified))
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                $"[InvalidIncidentTransition] Cannot classify an incident in status {Status}.");
        GuardSeverity(severity);

        Category = category;
        Severity = severity;
        Status = IncidentStatus.Classified;
        AppendTimeline(TimelineEntryType.Classified, actorId, note);
        MarkAsModified();
        AddDomainEvent(new IncidentClassified(Id, new IncidentClassifiedData(
            TenantId, category.ToString(), severity, actorId, note)));
    }

    public void Cancel(string reason, string actorId)
    {
        if (Status is IncidentStatus.Cancelled or IncidentStatus.Resolved)
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                $"[InvalidIncidentTransition] Cannot cancel an incident in status {Status}.");
        if (string.IsNullOrWhiteSpace(reason))
            throw BusinessRuleException.Violation("CancellationReasonRequired",
                "[CancellationReasonRequired] A reason is required to cancel an incident.");

        Status = IncidentStatus.Cancelled;
        CancellationReason = reason.Trim();
        AppendTimeline(TimelineEntryType.Cancelled, actorId, reason.Trim());
        MarkAsModified();
        AddDomainEvent(new IncidentCancelled(Id, new IncidentCancelledData(TenantId, reason.Trim(), actorId)));
    }

    public void RequestIsolationAnalysis(string startNodeId, string actorId)
    {
        if (Status is not (IncidentStatus.Classified or IncidentStatus.IsolationPlanReady or IncidentStatus.IsolationRequested))
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                $"[InvalidIncidentTransition] Cannot request isolation analysis from status {Status}.");
        if (string.IsNullOrWhiteSpace(startNodeId))
            throw BusinessRuleException.Violation("StartNodeRequired",
                "[StartNodeRequired] A start node id is required for isolation analysis.");

        SupersedeActiveProposedPlan();
        Status = IncidentStatus.IsolationRequested;
        AppendTimeline(TimelineEntryType.IsolationRequested, actorId, $"start={startNodeId.Trim()}");
        // No MarkAsModified: event-less transition. AggregateRepositoryBase derives expectedVersion = Version - domainEvents.Count, so a version bump without a paired domain event breaks optimistic concurrency (decision 0023).
    }

    public void RecordIsolationPlan(
        long graphVersion, IReadOnlyList<string> valvesToClose, IReadOnlyList<string> isolatedNodes,
        IReadOnlyList<string> isolatedPipes, string actorId)
    {
        if (Status != IncidentStatus.IsolationRequested)
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                $"[InvalidIncidentTransition] Cannot record an isolation plan from status {Status}.");

        var startNodeId = LatestStartNodeId();
        var plan = IsolationPlan.Proposed(Id, startNodeId, graphVersion, valvesToClose, isolatedNodes, isolatedPipes, _isolationPlans.Count);
        _isolationPlans.Add(plan);
        Status = IncidentStatus.IsolationPlanReady;
        AppendTimeline(TimelineEntryType.IsolationPlanReady, actorId, $"valves={valvesToClose.Count}");
        MarkAsModified();
        AddDomainEvent(new IncidentIsolationPlanCreated(Id, new IncidentIsolationPlanCreatedData(
            TenantId, plan.Id, startNodeId, graphVersion, valvesToClose, isolatedNodes, isolatedPipes, actorId)));
    }

    public void RecordAnalysisFailure(string reason, string actorId)
    {
        if (Status != IncidentStatus.IsolationRequested)
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                $"[InvalidIncidentTransition] Cannot record an analysis failure from status {Status}.");

        _isolationPlans.Add(IsolationPlan.Failed(Id, LatestStartNodeId(), reason, _isolationPlans.Count));
        AppendTimeline(TimelineEntryType.AnalysisFailed, actorId, reason);
        // No MarkAsModified: event-less transition. AggregateRepositoryBase derives expectedVersion = Version - domainEvents.Count, so a version bump without a paired domain event breaks optimistic concurrency (decision 0023).
    }

    public void ConfirmIsolationPlan(string actorId, string? note)
    {
        if (Status != IncidentStatus.IsolationPlanReady)
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                $"[InvalidIncidentTransition] Cannot confirm an isolation plan from status {Status}.");

        var idx = _isolationPlans.FindIndex(p => p.Status == IsolationPlanStatus.Proposed);
        if (idx < 0)
            throw BusinessRuleException.Violation("NoProposedPlan",
                "[NoProposedPlan] There is no proposed isolation plan to confirm.");

        var confirmed = _isolationPlans[idx].AsConfirmed();
        _isolationPlans[idx] = confirmed;
        Status = IncidentStatus.IsolationConfirmed;
        AppendTimeline(TimelineEntryType.IsolationConfirmed, actorId, note);
        MarkAsModified();
        AddDomainEvent(new IncidentIsolationPlanConfirmed(Id, new IncidentIsolationPlanConfirmedData(
            TenantId, confirmed.Id, confirmed.GraphVersion,
            confirmed.ValvesToClose, confirmed.IsolatedNodes, confirmed.IsolatedPipes,
            _affectedRefs.Select(r => new IncidentAssetRefData(r.AssetId, r.Kind.ToString())).ToList(),
            actorId)));
    }

    public void StartIncidentHandling(string actorId, string? note)
    {
        if (Status != IncidentStatus.IsolationConfirmed)
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                $"[InvalidIncidentTransition] Cannot start incident handling from status {Status}.");

        Status = IncidentStatus.InProgress;
        AppendTimeline(TimelineEntryType.HandlingStarted, actorId, note);
        MarkAsModified();
        AddDomainEvent(new WorkOrderRequested(Id, new WorkOrderRequestedData(
            _affectedRefs.Select(r => new IncidentAssetRefData(r.AssetId, r.Kind.ToString())).ToList(),
            $"{Category} severity {Severity}",
            Severity)));
    }

    public void ResolveIncident(string actorId, string? resolutionNote)
    {
        if (Status != IncidentStatus.InProgress)
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                $"[InvalidIncidentTransition] Cannot resolve an incident from status {Status}.");

        Status = IncidentStatus.Resolved;
        AppendTimeline(TimelineEntryType.Resolved, actorId, resolutionNote);
        MarkAsModified();
        AddDomainEvent(new IncidentResolved(Id, new IncidentResolvedData(TenantId, actorId, resolutionNote?.Trim())));
    }

    private void SupersedeActiveProposedPlan()
    {
        for (var idx = 0; idx < _isolationPlans.Count; idx++)
            if (_isolationPlans[idx].Status == IsolationPlanStatus.Proposed)
                _isolationPlans[idx] = _isolationPlans[idx].AsSuperseded();
    }

    // The start node of the most recent IsolationRequested transition is recorded in the timeline note.
    private string LatestStartNodeId()
    {
        var entry = _timeline.LastOrDefault(t => t.EntryType == TimelineEntryType.IsolationRequested);
        return entry?.Note?.StartsWith("start=", StringComparison.Ordinal) == true
            ? entry.Note["start=".Length..]
            : string.Empty;
    }

    private void AppendTimeline(TimelineEntryType type, string actorId, string? note)
        => _timeline.Add(IncidentTimelineEntry.Create(type, actorId, note, _timeline.Count));

    private static void GuardSeverity(int severity)
    {
        if (severity is < 1 or > 4)
            throw BusinessRuleException.Violation("InvalidSeverity",
                "[InvalidSeverity] Severity must be between 1 and 4.");
    }

    private static void GuardLocation(double? longitude, double? latitude)
    {
        if (longitude.HasValue != latitude.HasValue)
            throw BusinessRuleException.Violation("InvalidLocation",
                "[InvalidLocation] Longitude and latitude must be provided together.");
    }

    public static NetworkIncident Reconstitute(
        string id, string tenantId, IncidentCategory category, int severity,
        double? longitude, double? latitude, IncidentStatus status, string reportedBy,
        string? cancellationReason, int version, DateTime createdAt, DateTime updatedAt,
        IEnumerable<AssetRef> affectedRefs, IEnumerable<IncidentTimelineEntry> timeline,
        IEnumerable<IsolationPlan>? isolationPlans = null)
    {
        var incident = new NetworkIncident(id, tenantId, category, severity, longitude, latitude,
            status, reportedBy, cancellationReason, version, createdAt, updatedAt);
        incident._affectedRefs.AddRange(affectedRefs);
        incident._timeline.AddRange(timeline);
        incident._isolationPlans.AddRange(isolationPlans ?? []);
        return incident;
    }
}
