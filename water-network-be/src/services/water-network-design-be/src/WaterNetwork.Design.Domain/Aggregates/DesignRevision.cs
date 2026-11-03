using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.Domain.Aggregates;

public sealed class DesignRevision : AggregateRoot
{
    private readonly List<DesignRevisionTransition> _transitions = [];

    public IReadOnlyList<NetworkEditOperation>? NetworkEdits { get; private set; }

    public string ProjectId { get; private set; }
    public string TenantId { get; private set; }
    public int RevisionNumber { get; private set; }
    public DesignRevisionStatus Status { get; private set; }
    public ValidationResult? ValidationResult { get; private set; }
    public IReadOnlyList<DesignRevisionTransition> Transitions => _transitions.AsReadOnly();

    private DesignRevision(
        string id, string projectId, string tenantId, int revisionNumber,
        DesignRevisionStatus status, ValidationResult? validationResult,
        int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        ProjectId = projectId;
        TenantId = tenantId;
        RevisionNumber = revisionNumber;
        Status = status;
        ValidationResult = validationResult;
    }

    public static DesignRevision Create(string projectId, string tenantId, int revisionNumber)
    {
        var rev = new DesignRevision(
            Guid.CreateVersion7().ToString(), projectId, tenantId, revisionNumber,
            DesignRevisionStatus.Draft, validationResult: null);
        rev.MarkAsModified();
        rev.AddDomainEvent(new DesignRevisionCreated(
            rev.Id, new DesignRevisionCreatedData(projectId, tenantId, revisionNumber)));
        return rev;
    }

    public void ApplyValidation(ValidationResult result)
    {
        EnsureDraftsEditable();
        ValidationResult = result;
        Status = result.HasErrors ? DesignRevisionStatus.Draft : DesignRevisionStatus.Validated;
        MarkAsModified();
        AddDomainEvent(new DesignRevisionValidated(Id, new DesignRevisionValidatedData(
            ProjectId, TenantId, result.Errors.Count, result.Warnings.Count, !result.HasErrors)));
    }

    /// <summary>Any draft mutation invalidates a previously-Validated revision.</summary>
    public void MarkDraftsChanged()
    {
        EnsureDraftsEditable();
        Status = DesignRevisionStatus.Draft;
        ValidationResult = null;
        MarkAsModified();
        AddDomainEvent(new DesignRevisionDraftsChanged(Id, new DesignRevisionDraftsChangedData(ProjectId, TenantId)));
    }

    /// <summary>Drafts may only be added/changed while the revision is open for editing.</summary>
    public void EnsureDraftsEditable()
    {
        if (Status is DesignRevisionStatus.Submitted
            or DesignRevisionStatus.Approved
            or DesignRevisionStatus.Published
            or DesignRevisionStatus.PartiallyPublished)
            throw BusinessRuleException.Violation("RevisionNotEditable",
                $"[RevisionNotEditable] Revision is {Status}; draft assets can only be changed in Draft or Validated.");
    }

    public void SaveNetworkEdits(IReadOnlyList<NetworkEditOperation> operations, int expectedVersion)
    {
        EnsureDraftsEditable();
        if (Version != expectedVersion)
            throw ConcurrencyException.VersionMismatch(Id, expectedVersion, Version);
        if (operations.Count > 2000)
            throw BusinessRuleException.Violation("TooManyOperations", "A revision supports at most 2000 operations.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var targets = new HashSet<string>(StringComparer.Ordinal);
        foreach (var op in operations)
        {
            if (string.IsNullOrWhiteSpace(op.Id) || op.Id.Length > 64 || !ids.Add(op.Id)
                || op.Kind is not ("Node" or "Pipe" or "Device")
                || op.Action is not ("Add" or "Update" or "Delete"))
                throw BusinessRuleException.Violation("InvalidOperation", "Invalid or duplicate edit operation.");
            if (op.Action == "Add" && (op.TargetId != null || op.ExpectedVersion != null || op.Before != null))
                throw BusinessRuleException.Violation("InvalidTarget", "New assets cannot specify an existing target.");
            if (op.Action != "Add" && (string.IsNullOrWhiteSpace(op.TargetId) || op.ExpectedVersion is null or < 0
                || op.Before == null || op.Before.Kind != op.Kind || !targets.Add(op.TargetId)))
                throw BusinessRuleException.Violation("InvalidTarget", "An existing target requires a unique ID, version and server snapshot.");
            if (op.Action != "Delete" && (op.After == null || op.After.Kind != op.Kind || op.After.DraftAssetId != op.Id))
                throw BusinessRuleException.Violation("InvalidOperation", "An edit requires matching after content.");
        }
        NetworkEdits = operations.Select(op => op with { Before = Copy(op.Before), After = Copy(op.After) }).ToArray();
        MarkDraftsChanged();
    }

    private static DraftAssetSnapshot? Copy(DraftAssetSnapshot? asset) => asset is null ? null : asset with
    {
        Geometry = asset.Geometry with { Coordinates = asset.Geometry.Coordinates.Select(p => (IReadOnlyList<double>)p.ToArray()).ToArray() },
        Attributes = new System.Collections.ObjectModel.ReadOnlyDictionary<string, string>(asset.Attributes.ToDictionary(x => x.Key, x => x.Value))
    };

    public void Submit(string actorId, string? correlationId)
    {
        if (Status != DesignRevisionStatus.Validated)
            throw BusinessRuleException.Violation("InvalidRevisionTransition",
                $"[InvalidRevisionTransition] Cannot submit a revision in status {Status}; it must be Validated.");
        ApplyTransition(DesignRevisionStatus.Submitted, actorId, reason: null, correlationId);
        AddDomainEvent(new DesignRevisionSubmitted(Id, new DesignRevisionSubmittedData(
            ProjectId, TenantId, RevisionNumber, actorId)));
    }

    public void Approve(string actorId, string? reason, string? correlationId)
    {
        if (Status != DesignRevisionStatus.Submitted)
            throw BusinessRuleException.Violation("InvalidRevisionTransition",
                $"[InvalidRevisionTransition] Cannot approve a revision in status {Status}; it must be Submitted.");
        ApplyTransition(DesignRevisionStatus.Approved, actorId, reason, correlationId);
        AddDomainEvent(new DesignRevisionApproved(Id, new DesignRevisionApprovedData(
            ProjectId, TenantId, RevisionNumber, actorId, reason)));
    }

    public void Reject(string actorId, string reason, string? correlationId)
    {
        if (Status != DesignRevisionStatus.Submitted)
            throw BusinessRuleException.Violation("InvalidRevisionTransition",
                $"[InvalidRevisionTransition] Cannot reject a revision in status {Status}; it must be Submitted.");
        if (string.IsNullOrWhiteSpace(reason))
            throw BusinessRuleException.Violation("RejectReasonRequired",
                "[RejectReasonRequired] A reason is required when rejecting a revision.");
        ApplyTransition(DesignRevisionStatus.Draft, actorId, reason, correlationId);
        ValidationResult = null; // back to Draft → must re-validate after edits
        AddDomainEvent(new DesignRevisionRejected(Id, new DesignRevisionRejectedData(
            ProjectId, TenantId, RevisionNumber, actorId, reason)));
    }

    public void MarkPublished(int importedCount, int failedCount, string actorId, string? correlationId)
    {
        if (Status != DesignRevisionStatus.Approved)
            throw BusinessRuleException.Violation("InvalidRevisionTransition",
                $"[InvalidRevisionTransition] Cannot publish a revision in status {Status}; it must be Approved.");

        var target = failedCount == 0
            ? DesignRevisionStatus.Published
            : DesignRevisionStatus.PartiallyPublished;

        ApplyTransition(target, actorId, reason: null, correlationId);
        AddDomainEvent(new DesignRevisionPublished(Id, new DesignRevisionPublishedData(
            ProjectId, TenantId, RevisionNumber, actorId, target.ToString(), importedCount, failedCount)));
    }

    /// <summary>Emits the batch ready-for-gis event. Status stays Approved until GIS reports completion
    /// (see MarkPublished). Idempotency on re-trigger is provided by the inbox dedup of the approved event.</summary>
    public void BeginPublish(IReadOnlyList<DraftAssetSnapshot> drafts, string approvedBy)
    {
        if (Status != DesignRevisionStatus.Approved)
            throw BusinessRuleException.Violation("InvalidRevisionTransition",
                $"[InvalidRevisionTransition] Cannot publish a revision in status {Status}; it must be Approved.");

        if (NetworkEdits is { } edits)
        {
            MarkAsModified();
            AddDomainEvent(new DesignNetworkEditsReady(Id, new(TenantId, approvedBy, edits)));
            return;
        }

        // No ApplyTransition: this is not a status change, so no transition row is recorded —
        // only bump the aggregate version so the change participates in the unit of work.
        MarkAsModified();
        AddDomainEvent(new DesignAssetReadyForGis(Id, new DesignAssetReadyForGisData(
            ProjectId, TenantId, RevisionNumber, approvedBy, drafts)));
    }

    private void ApplyTransition(DesignRevisionStatus to, string actorId, string? reason, string? correlationId)
    {
        _transitions.Add(new DesignRevisionTransition(Status, to, actorId, reason, correlationId, DateTime.UtcNow));
        Status = to;
        MarkAsModified();
    }

    public static DesignRevision Reconstitute(
        string id, string projectId, string tenantId, int revisionNumber,
        DesignRevisionStatus status, ValidationResult? validationResult,
        int version, DateTime createdAt, DateTime updatedAt,
        IEnumerable<DesignRevisionTransition> transitions,
        IReadOnlyList<NetworkEditOperation>? networkEdits = null)
    {
        var rev = new DesignRevision(id, projectId, tenantId, revisionNumber, status, validationResult,
            version, createdAt, updatedAt);
        rev._transitions.AddRange(transitions);
        rev.NetworkEdits = networkEdits;
        return rev;
    }
}
