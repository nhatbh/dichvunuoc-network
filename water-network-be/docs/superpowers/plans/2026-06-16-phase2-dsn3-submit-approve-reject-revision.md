# DSN-3 Submit / Approve / Reject Design Revision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép một `DesignRevision` đã `Validated` đi qua vòng phê duyệt — submit (designer) → approve/reject (người duyệt) — với audit transition append-only và permission enforcement lần đầu (`network-design:approve`).

**Architecture:** Mở rộng aggregate `DesignRevision` (đã có ở DSN-2) với 3 transition method + child entity append-only `DesignRevisionTransition` (mirror pattern `NetworkAsset` + `AssetLifecycleEntry` của asset-be). Mỗi transition: validate state → đổi `Status` → append transition → raise domain event → outbox. 3 endpoint khai báo permission qua `.RequirePermission(...)` của BuildingBlocks.Security. Reject đưa revision về `Draft` (xóa `ValidationResult`). Draft-asset mutation bị chặn (422) khi revision `Submitted`/`Approved`.

**Tech Stack:** .NET 10, EF Core (Npgsql + NetTopologySuite), custom CQRS (`ICommandBus`/`IQueryBus`), FluentValidation, transactional outbox, xUnit + FluentAssertions, Testcontainers PostGIS (`PostgisFixture`).

**Spec:** `docs/superpowers/specs/2026-06-16-dsn3-submit-approve-reject-revision-design.md`

**Quyết định đã chốt (brainstorm 2026-06-16):** reject → `Draft`; audit ở bảng append-only riêng; submit=`network-design:write`, approve/reject=`network-design:approve`; reject reason bắt buộc, approve optional; API path giữ `/api/design/...`.

**Lưu ý chệch spec (đã cập nhật theo pattern chuẩn):** spec phác `_newTransitions`; plan dùng **pattern canonical của asset-be** — EF nav collection `Transitions` (HasMany), repo `Include` + insert phần mới bằng `Skip(existing.Transitions.Count)`. Lý do: nhất quán `NetworkAssetRepository`, ít rủi ro hơn.

**Quy ước test (CLAUDE.md / backlog):** KHÔNG chạy `dotnet test *.slnx` (SDK 10 chạy 0 test). Luôn chạy theo từng `.csproj`. Đường dẫn gốc repo.

| Test project | csproj |
|---|---|
| Unit | `src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj` |
| Contract | `src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj` |
| Integration | `src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj` |

---

## File Structure

**Domain** (`src/services/water-network-design-be/src/WaterNetwork.Design.Domain/`)
- Modify `ValueObjects/DesignRevisionStatus.cs` — thêm `Submitted`, `Approved`.
- Create `Entities/DesignRevisionTransition.cs` — child append-only.
- Create `DomainEvents/DesignRevisionSubmitted.cs`, `DesignRevisionApproved.cs`, `DesignRevisionRejected.cs`.
- Modify `Aggregates/DesignRevision.cs` — `_transitions`, `Submit/Approve/Reject`, `EnsureDraftsEditable`, `Reconstitute`.

**Application** (`.../WaterNetwork.Design.Application/`)
- Create `Commands/SubmitDesignRevisionCommand.cs` + `…Handler.cs`.
- Create `Commands/ApproveDesignRevisionCommand.cs` + `…Handler.cs`.
- Create `Commands/RejectDesignRevisionCommand.cs` + `…Handler.cs`.
- Create `Validators/RejectDesignRevisionCommandValidator.cs`.
- Create `Dtos/RevisionTransitionDto.cs`; Modify `Dtos/DesignRevisionDetailDto.cs` (+ `Transitions`).
- Modify `Ports/IDesignRevisionReadDao.cs` — `ListTransitionsAsync`.
- Modify `Commands/CreateDraftAssetCommandHandler.cs`, `CreateDraftAssetsBatchCommandHandler.cs`, `UpdateDraftGeometryCommandHandler.cs` — draft-mutation guard.

**Contracts** (`.../WaterNetwork.Design.Contracts/`)
- Modify `DesignEventTypes.cs` — 3 const.
- Create `Events/DesignRevisionSubmittedV1.cs`, `DesignRevisionApprovedV1.cs`, `DesignRevisionRejectedV1.cs`.
- Create `Requests/ApproveRevisionRequest.cs`, `RejectRevisionRequest.cs`.

**Infrastructure** (`.../WaterNetwork.Design.Infrastructure/`)
- Create `Persistence/DesignRevisionTransitionPersistenceModel.cs`.
- Create `Persistence/Configurations/DesignRevisionTransitionConfiguration.cs`.
- Modify `Persistence/DesignRevisionPersistenceModel.cs` — nav `Transitions`.
- Modify `Persistence/Configurations/DesignRevisionConfiguration.cs` — `HasMany`.
- Create migration `Persistence/Migrations/<ts>_AddDesignRevisionTransitions.cs` (+ Designer) via `dotnet ef`.
- Modify `Repositories/DesignRevisionRepository.cs` — `GetByIdAsync` Include, `PersistAsync` insert transitions, map transitions in `ToModel`/`ToDomain`.
- Modify `Repositories/DesignRevisionReadDao.cs` — `ListTransitionsAsync` + embed in detail.
- Modify `IntegrationEvents/DesignIntegrationEventMapper.cs` — 3 integration events + registry entries.

**Api** (`.../WaterNetwork.Design.Api/`)
- Modify `Endpoints/RevisionsEndpointModule.cs` — 3 endpoint.
- Create `Validators/RejectRevisionRequestValidator.cs`.

**Tests**
- Create `tests/.../UnitTests/DesignRevisionTransitionTests.cs`.
- Modify `tests/.../ContractTests/DesignRevisionEventsContractTests.cs`.
- Create `tests/.../IntegrationTests/DesignRevisionApprovalApiTests.cs`.

**Docs**
- Create `docs/decisions/0014-design-approval-permission-and-audit.md`.
- Modify `docs/conventions/event-catalog.md`, `docs/stories/backlog.md`, roadmap checkbox.

---

## Task 1: Domain — states, transition entity, events, aggregate methods

**Files:**
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/ValueObjects/DesignRevisionStatus.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/Entities/DesignRevisionTransition.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/DomainEvents/DesignRevisionSubmitted.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/DomainEvents/DesignRevisionApproved.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/DomainEvents/DesignRevisionRejected.cs`
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/Aggregates/DesignRevision.cs`
- Test: `src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DesignRevisionTransitionTests.cs`

- [ ] **Step 1: Write the failing tests**

Create `DesignRevisionTransitionTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.UnitTests;

public sealed class DesignRevisionTransitionTests
{
    private static DesignRevision Validated()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.ApplyValidation(ValidationResult.Empty);
        rev.ClearDomainEvents();
        return rev;
    }

    [Fact]
    public void Submit_From_Validated_Moves_To_Submitted_And_Records_Transition()
    {
        var rev = Validated();

        rev.Submit("user-1", "corr-1");

        rev.Status.Should().Be(DesignRevisionStatus.Submitted);
        rev.Transitions.Should().ContainSingle();
        var t = rev.Transitions[0];
        t.FromStatus.Should().Be(DesignRevisionStatus.Validated);
        t.ToStatus.Should().Be(DesignRevisionStatus.Submitted);
        t.ActorId.Should().Be("user-1");
        t.CorrelationId.Should().Be("corr-1");
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionSubmitted);
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Draft)]
    [InlineData(DesignRevisionStatus.Submitted)]
    [InlineData(DesignRevisionStatus.Approved)]
    public void Submit_From_Non_Validated_Throws(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.Submit("user-1", null);
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("InvalidRevisionTransition");
    }

    [Fact]
    public void Approve_From_Submitted_Moves_To_Approved_With_Optional_Reason()
    {
        var rev = Validated();
        rev.Submit("user-1", null);
        rev.ClearDomainEvents();

        rev.Approve("approver-1", "looks good", "corr-2");

        rev.Status.Should().Be(DesignRevisionStatus.Approved);
        rev.Transitions.Should().HaveCount(2);
        rev.Transitions[^1].ToStatus.Should().Be(DesignRevisionStatus.Approved);
        rev.Transitions[^1].Reason.Should().Be("looks good");
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionApproved);
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Draft)]
    [InlineData(DesignRevisionStatus.Validated)]
    [InlineData(DesignRevisionStatus.Approved)]
    public void Approve_From_Non_Submitted_Throws(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.Approve("approver-1", null, null);
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("InvalidRevisionTransition");
    }

    [Fact]
    public void Reject_From_Submitted_Returns_To_Draft_And_Clears_Validation()
    {
        var rev = Validated();
        rev.Submit("user-1", null);
        rev.ClearDomainEvents();

        rev.Reject("approver-1", "missing elevation", "corr-3");

        rev.Status.Should().Be(DesignRevisionStatus.Draft);
        rev.ValidationResult.Should().BeNull();
        rev.Transitions[^1].FromStatus.Should().Be(DesignRevisionStatus.Submitted);
        rev.Transitions[^1].ToStatus.Should().Be(DesignRevisionStatus.Draft);
        rev.Transitions[^1].Reason.Should().Be("missing elevation");
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionRejected);
    }

    [Fact]
    public void Reject_Without_Reason_Throws()
    {
        var rev = Validated();
        rev.Submit("user-1", null);
        var act = () => rev.Reject("approver-1", "  ", null);
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("RejectReasonRequired");
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Submitted)]
    [InlineData(DesignRevisionStatus.Approved)]
    public void EnsureDraftsEditable_Throws_When_Not_Editable(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.EnsureDraftsEditable();
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("RevisionNotEditable");
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Draft)]
    [InlineData(DesignRevisionStatus.Validated)]
    public void EnsureDraftsEditable_Allows_Editable_States(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.EnsureDraftsEditable();
        act.Should().NotThrow();
    }

    private static DesignRevision ReconstituteWith(DesignRevisionStatus status) =>
        DesignRevision.Reconstitute("id-1", "proj-1", "tenant-1", 1, status,
            validationResult: null, version: 1,
            createdAt: DateTime.UtcNow, updatedAt: DateTime.UtcNow,
            transitions: Array.Empty<DesignRevisionTransition>());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --filter "FullyQualifiedName~DesignRevisionTransitionTests"`
Expected: BUILD FAILS — `Submitted`/`Approved` undefined, `Submit`/`Approve`/`Reject`/`EnsureDraftsEditable`/`Transitions` undefined, `Reconstitute` signature mismatch, event types undefined.

- [ ] **Step 3: Extend the status enum**

Replace `ValueObjects/DesignRevisionStatus.cs` body:

```csharp
// DesignRevisionStatus.cs
namespace WaterNetwork.Design.Domain.ValueObjects;

public enum DesignRevisionStatus
{
    Draft,
    Validated,
    Submitted,
    Approved
}
```

- [ ] **Step 4: Create the transition entity**

Create `Entities/DesignRevisionTransition.cs`:

```csharp
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.Domain.Entities;

/// <summary>Append-only audit record of a single revision state transition.</summary>
public sealed class DesignRevisionTransition
{
    public DesignRevisionStatus FromStatus { get; }
    public DesignRevisionStatus ToStatus { get; }
    public string ActorId { get; }
    public string? Reason { get; }
    public string? CorrelationId { get; }
    public DateTime OccurredAt { get; }

    public DesignRevisionTransition(
        DesignRevisionStatus fromStatus, DesignRevisionStatus toStatus,
        string actorId, string? reason, string? correlationId, DateTime occurredAt)
    {
        FromStatus = fromStatus;
        ToStatus = toStatus;
        ActorId = actorId;
        Reason = reason;
        CorrelationId = correlationId;
        OccurredAt = occurredAt;
    }
}
```

- [ ] **Step 5: Create the three domain events**

Create `DomainEvents/DesignRevisionSubmitted.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionSubmittedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId);

public sealed record DesignRevisionSubmitted(string AggregateId, DesignRevisionSubmittedData Data)
    : DomainEventBase<DesignRevisionSubmittedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionSubmitted",
        data: Data);
```

Create `DomainEvents/DesignRevisionApproved.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionApprovedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string? Reason);

public sealed record DesignRevisionApproved(string AggregateId, DesignRevisionApprovedData Data)
    : DomainEventBase<DesignRevisionApprovedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionApproved",
        data: Data);
```

Create `DomainEvents/DesignRevisionRejected.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionRejectedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string Reason);

public sealed record DesignRevisionRejected(string AggregateId, DesignRevisionRejectedData Data)
    : DomainEventBase<DesignRevisionRejectedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignRevision",
        eventType: "DesignRevisionRejected",
        data: Data);
```

- [ ] **Step 6: Add transition methods to the aggregate**

In `Aggregates/DesignRevision.cs`: add `using WaterNetwork.Design.Domain.Entities;` and `using WaterPlatform.BuildingBlocks.Domain.Exceptions;` at top. Add a backing field + read-only collection, the 3 methods, the guard, and update `Reconstitute`. Full new file:

```csharp
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.Domain.Aggregates;

public sealed class DesignRevision : AggregateRoot
{
    private readonly List<DesignRevisionTransition> _transitions = [];

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
        ValidationResult = result;
        Status = result.HasErrors ? DesignRevisionStatus.Draft : DesignRevisionStatus.Validated;
        MarkAsModified();
        AddDomainEvent(new DesignRevisionValidated(Id, new DesignRevisionValidatedData(
            ProjectId, TenantId, result.Errors.Count, result.Warnings.Count, !result.HasErrors)));
    }

    /// <summary>Any draft mutation invalidates a previously-Validated revision.</summary>
    public void MarkDraftsChanged()
    {
        if (Status != DesignRevisionStatus.Validated) return;
        Status = DesignRevisionStatus.Draft;
        ValidationResult = null;
        MarkAsModified();
    }

    /// <summary>Drafts may only be added/changed while the revision is open for editing.</summary>
    public void EnsureDraftsEditable()
    {
        if (Status is DesignRevisionStatus.Submitted or DesignRevisionStatus.Approved)
            throw BusinessRuleException.Violation("RevisionNotEditable",
                $"[RevisionNotEditable] Revision is {Status}; draft assets can only be changed in Draft or Validated.");
    }

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
        IEnumerable<DesignRevisionTransition> transitions)
    {
        var rev = new DesignRevision(id, projectId, tenantId, revisionNumber, status, validationResult,
            version, createdAt, updatedAt);
        rev._transitions.AddRange(transitions);
        return rev;
    }
}
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --filter "FullyQualifiedName~DesignRevisionTransitionTests"`
Expected: PASS (all). NOTE: `Reconstitute` signature changed — `DesignRevisionRepository.ToDomain` (Task 2) will be updated next; the **repository project does not compile yet**, but the UnitTests project references Domain only, so this filtered run passes.

- [ ] **Step 8: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Domain \
        src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DesignRevisionTransitionTests.cs
git commit -m "feat(design): DesignRevision submit/approve/reject domain + transitions (DSN-3)"
```

---

## Task 2: Persistence — transition table, repository, migration

**Files:**
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Persistence/DesignRevisionTransitionPersistenceModel.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Persistence/Configurations/DesignRevisionTransitionConfiguration.cs`
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Persistence/DesignRevisionPersistenceModel.cs`
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Persistence/Configurations/DesignRevisionConfiguration.cs`
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Repositories/DesignRevisionRepository.cs`
- Create (via `dotnet ef`): migration under `.../Persistence/Migrations/`

- [ ] **Step 1: Create the transition persistence model**

Create `Persistence/DesignRevisionTransitionPersistenceModel.cs`:

```csharp
namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignRevisionTransitionPersistenceModel
{
    public long Id { get; set; }
    public string RevisionId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string FromStatus { get; set; } = default!;
    public string ToStatus { get; set; } = default!;
    public string ActorId { get; set; } = default!;
    public string? Reason { get; set; }
    public string? CorrelationId { get; set; }
    public DateTime OccurredAt { get; set; }
}
```

- [ ] **Step 2: Add nav collection to the revision persistence model**

Replace `Persistence/DesignRevisionPersistenceModel.cs`:

```csharp
namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignRevisionPersistenceModel
{
    public string Id { get; set; } = default!;
    public string ProjectId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public int RevisionNumber { get; set; }
    public string Status { get; set; } = default!;
    public string? ValidationResultJson { get; set; }
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<DesignRevisionTransitionPersistenceModel> Transitions { get; set; } = [];
}
```

- [ ] **Step 3: Create the transition EF configuration**

Create `Persistence/Configurations/DesignRevisionTransitionConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignRevisionTransitionConfiguration
    : IEntityTypeConfiguration<DesignRevisionTransitionPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignRevisionTransitionPersistenceModel> builder)
    {
        builder.ToTable("design_revision_transitions");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedOnAdd();
        builder.Property(x => x.RevisionId).HasColumnName("revision_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.FromStatus).HasColumnName("from_status").HasMaxLength(16).IsRequired();
        builder.Property(x => x.ToStatus).HasColumnName("to_status").HasMaxLength(16).IsRequired();
        builder.Property(x => x.ActorId).HasColumnName("actor_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Reason).HasColumnName("reason");
        builder.Property(x => x.CorrelationId).HasColumnName("correlation_id").HasMaxLength(128);
        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at");
        builder.HasIndex(x => new { x.TenantId, x.RevisionId })
            .HasDatabaseName("ix_revision_transitions_tenant_revision");
    }
}
```

- [ ] **Step 4: Wire the HasMany relationship in the revision configuration**

In `Persistence/Configurations/DesignRevisionConfiguration.cs`, add inside `Configure` (after the existing `HasOne<DesignProjectPersistenceModel>()...` block):

```csharp
        builder.HasMany(x => x.Transitions)
            .WithOne()
            .HasForeignKey(x => x.RevisionId)
            .OnDelete(DeleteBehavior.Restrict);
```

- [ ] **Step 5: Update the repository (Include + insert new transitions + map)**

Replace `Repositories/DesignRevisionRepository.cs` body of `GetByIdAsync`, `PersistAsync`, `ToModel`, `ToDomain` (keep `using`s; add `using WaterNetwork.Design.Domain.Entities;`):

```csharp
    public override async Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignRevisionPersistenceModel>().AsNoTracking()
            .Include(x => x.Transitions)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : ToDomain(m);
    }
```

```csharp
    protected override async Task PersistAsync(DesignRevision aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.Set<DesignRevisionPersistenceModel>()
            .Include(x => x.Transitions)
            .FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
        if (existing is null)
        {
            if (expectedVersion > 0)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            dbContext.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);
            existing.Status = aggregate.Status.ToString();
            existing.ValidationResultJson = Serialize(aggregate.ValidationResult);
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;

            // Append-only transitions: insert the ones added since the last persist.
            foreach (var t in aggregate.Transitions.Skip(existing.Transitions.Count))
                existing.Transitions.Add(ToTransitionModel(aggregate, t));
        }
    }
```

```csharp
    private static DesignRevisionPersistenceModel ToModel(DesignRevision r) => new()
    {
        Id = r.Id, ProjectId = r.ProjectId, TenantId = r.TenantId, RevisionNumber = r.RevisionNumber,
        Status = r.Status.ToString(), ValidationResultJson = Serialize(r.ValidationResult),
        Version = r.Version, CreatedAt = r.CreatedAt, UpdatedAt = r.UpdatedAt,
        Transitions = r.Transitions.Select(t => ToTransitionModel(r, t)).ToList()
    };

    private static DesignRevisionTransitionPersistenceModel ToTransitionModel(DesignRevision r, DesignRevisionTransition t) => new()
    {
        RevisionId = r.Id, TenantId = r.TenantId,
        FromStatus = t.FromStatus.ToString(), ToStatus = t.ToStatus.ToString(),
        ActorId = t.ActorId, Reason = t.Reason, CorrelationId = t.CorrelationId, OccurredAt = t.OccurredAt
    };

    private static DesignRevision ToDomain(DesignRevisionPersistenceModel m) => DesignRevision.Reconstitute(
        m.Id, m.ProjectId, m.TenantId, m.RevisionNumber,
        Enum.Parse<DesignRevisionStatus>(m.Status), Deserialize(m.ValidationResultJson),
        m.Version, m.CreatedAt, m.UpdatedAt,
        m.Transitions
            .OrderBy(t => t.OccurredAt).ThenBy(t => t.Id)
            .Select(t => new DesignRevisionTransition(
                Enum.Parse<DesignRevisionStatus>(t.FromStatus), Enum.Parse<DesignRevisionStatus>(t.ToStatus),
                t.ActorId, t.Reason, t.CorrelationId, t.OccurredAt)));
```

- [ ] **Step 6: Build Infrastructure to confirm it compiles**

Run: `dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj`
Expected: BUILD SUCCEEDED, 0 warnings.

- [ ] **Step 7: Generate the migration**

Run:
```bash
dotnet ef migrations add AddDesignRevisionTransitions \
  -p src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure \
  -s src/services/water-network-design-be/src/WaterNetwork.Design.Api \
  -o Persistence/Migrations
```
Expected: creates `<timestamp>_AddDesignRevisionTransitions.cs` + `.Designer.cs` and updates `DesignDbContextModelSnapshot.cs`.

- [ ] **Step 8: Verify the generated migration**

Open the new `<timestamp>_AddDesignRevisionTransitions.cs`. Confirm `Up` creates table `design_revision_transitions` with columns `id` (identity), `revision_id`, `tenant_id`, `from_status`, `to_status`, `actor_id`, `reason`, `correlation_id`, `occurred_at`, an FK to `design_revisions(id)` with `onDelete: Restrict`, and index `ix_revision_transitions_tenant_revision`. It must NOT alter the `design_revisions` table (status column unchanged). If the FK/index are missing, the configuration in Steps 3–4 is wrong — fix and regenerate.

- [ ] **Step 9: Build the whole service to confirm everything compiles**

Run: `dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj`
Expected: BUILD SUCCEEDED, 0 warnings.

- [ ] **Step 10: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure
git commit -m "feat(design): persist DesignRevision transitions + migration (DSN-3)"
```

---

## Task 3: Contracts + outbox mapper

**Files:**
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/DesignEventTypes.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/Events/DesignRevisionSubmittedV1.cs`
- Create: `.../Events/DesignRevisionApprovedV1.cs`
- Create: `.../Events/DesignRevisionRejectedV1.cs`
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/IntegrationEvents/DesignIntegrationEventMapper.cs`
- Test: `src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/DesignRevisionEventsContractTests.cs`

- [ ] **Step 1: Add the failing contract tests**

Append to `DesignRevisionEventsContractTests.cs` (inside the class):

```csharp
    [Fact]
    public void RevisionSubmitted_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionSubmittedV1("rev-1", "p1", "tenant-1", 2, "user-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "RevisionNumber", "ActorId");
    }

    [Fact]
    public void RevisionApproved_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionApprovedV1("rev-1", "p1", "tenant-1", 2, "approver-1", "ok");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "RevisionNumber", "ActorId", "Reason");
    }

    [Fact]
    public void RevisionRejected_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionRejectedV1("rev-1", "p1", "tenant-1", 2, "approver-1", "missing data");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "RevisionNumber", "ActorId", "Reason");
    }

    [Fact]
    public void Approval_Event_Types_Are_Fixed()
    {
        DesignEventTypes.RevisionSubmitted.Should().Be("design.revision.submitted");
        DesignEventTypes.RevisionApproved.Should().Be("design.revision.approved");
        DesignEventTypes.RevisionRejected.Should().Be("design.revision.rejected");
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj`
Expected: BUILD FAILS — `DesignRevisionSubmittedV1` etc. and `DesignEventTypes.RevisionSubmitted` undefined.

- [ ] **Step 3: Add the event type constants**

Replace `Contracts/DesignEventTypes.cs`:

```csharp
namespace WaterNetwork.Design.Contracts;

public static class DesignEventTypes
{
    public const string ProjectCreated = "design.project.created";
    public const string DocumentUploaded = "design.document.uploaded";
    public const string RevisionCreated = "design.revision.created";
    public const string RevisionValidated = "design.revision.validated";
    public const string RevisionSubmitted = "design.revision.submitted";
    public const string RevisionApproved = "design.revision.approved";
    public const string RevisionRejected = "design.revision.rejected";
}
```

- [ ] **Step 4: Create the three V1 payload records**

Create `Contracts/Events/DesignRevisionSubmittedV1.cs`:

```csharp
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.submitted</c>.</summary>
public sealed record DesignRevisionSubmittedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId);
```

Create `Contracts/Events/DesignRevisionApprovedV1.cs`:

```csharp
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.approved</c>.</summary>
public sealed record DesignRevisionApprovedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string? Reason);
```

Create `Contracts/Events/DesignRevisionRejectedV1.cs`:

```csharp
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.rejected</c>.</summary>
public sealed record DesignRevisionRejectedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ActorId,
    string Reason);
```

- [ ] **Step 5: Extend the integration event mapper**

In `Infrastructure/IntegrationEvents/DesignIntegrationEventMapper.cs`: add 3 integration-event records (after `DesignRevisionValidatedIntegrationEvent`), 3 registry entries, and 3 map methods.

Add records:

```csharp
public sealed record DesignRevisionSubmittedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionSubmittedV1 Data)
    : IIntegrationEvent<DesignRevisionSubmittedV1>;

public sealed record DesignRevisionApprovedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionApprovedV1 Data)
    : IIntegrationEvent<DesignRevisionApprovedV1>;

public sealed record DesignRevisionRejectedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionRejectedV1 Data)
    : IIntegrationEvent<DesignRevisionRejectedV1>;
```

Add to the `Registry` dictionary initializer:

```csharp
            ["DesignRevisionSubmitted"] = e => e is DesignRevisionSubmitted x ? MapRevisionSubmitted(x) : null,
            ["DesignRevisionApproved"] = e => e is DesignRevisionApproved x ? MapRevisionApproved(x) : null,
            ["DesignRevisionRejected"] = e => e is DesignRevisionRejected x ? MapRevisionRejected(x) : null,
```

Add the 3 map methods (after `MapRevisionValidated`):

```csharp
    private static DesignRevisionSubmittedIntegrationEvent MapRevisionSubmitted(DesignRevisionSubmitted e)
        => new(e.EventId, DesignEventTypes.RevisionSubmitted, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionSubmittedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId,
                e.Data.RevisionNumber, e.Data.ActorId));

    private static DesignRevisionApprovedIntegrationEvent MapRevisionApproved(DesignRevisionApproved e)
        => new(e.EventId, DesignEventTypes.RevisionApproved, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionApprovedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId,
                e.Data.RevisionNumber, e.Data.ActorId, e.Data.Reason));

    private static DesignRevisionRejectedIntegrationEvent MapRevisionRejected(DesignRevisionRejected e)
        => new(e.EventId, DesignEventTypes.RevisionRejected, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionRejectedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId,
                e.Data.RevisionNumber, e.Data.ActorId, e.Data.Reason));
```

> Note: outbox domain-event types are auto-registered — `Program.cs` already calls `AddOutboxDomainEventTypesFromAssembly(typeof(DesignProjectCreated).Assembly)`, which covers the 3 new events in the same Domain assembly. No DI change needed.

- [ ] **Step 6: Run contract tests to verify they pass**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj`
Expected: PASS (all, including the 3 new + the fixed event-types test).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Contracts \
        src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/IntegrationEvents \
        src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests
git commit -m "feat(design): DSN-3 revision approval events + outbox mapper (DSN-3)"
```

---

## Task 4: Application — commands, handlers, validators, read model

**Files:**
- Create: `.../WaterNetwork.Design.Application/Commands/SubmitDesignRevisionCommand.cs` + `SubmitDesignRevisionCommandHandler.cs`
- Create: `.../Commands/ApproveDesignRevisionCommand.cs` + `ApproveDesignRevisionCommandHandler.cs`
- Create: `.../Commands/RejectDesignRevisionCommand.cs` + `RejectDesignRevisionCommandHandler.cs`
- Create: `.../Validators/RejectDesignRevisionCommandValidator.cs`
- Create: `.../Dtos/RevisionTransitionDto.cs`
- Modify: `.../Dtos/DesignRevisionDetailDto.cs`
- Modify: `.../Ports/IDesignRevisionReadDao.cs`
- Modify: `.../Repositories/DesignRevisionReadDao.cs`
- Test: `src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/RejectDesignRevisionCommandValidatorTests.cs`

- [ ] **Step 1: Write the failing validator test**

Create `RejectDesignRevisionCommandValidatorTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Validators;

namespace WaterNetwork.Design.UnitTests;

public sealed class RejectDesignRevisionCommandValidatorTests
{
    private readonly RejectDesignRevisionCommandValidator _validator = new();

    [Fact]
    public void Empty_Reason_Is_Invalid()
    {
        var result = _validator.Validate(new RejectDesignRevisionCommand("rev-1", "  "));
        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.PropertyName == nameof(RejectDesignRevisionCommand.Reason));
    }

    [Fact]
    public void Non_Empty_Reason_Is_Valid()
    {
        var result = _validator.Validate(new RejectDesignRevisionCommand("rev-1", "missing elevation"));
        result.IsValid.Should().BeTrue();
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --filter "FullyQualifiedName~RejectDesignRevisionCommandValidatorTests"`
Expected: BUILD FAILS — `RejectDesignRevisionCommand` / validator undefined.

- [ ] **Step 3: Create the commands**

Create `Commands/SubmitDesignRevisionCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record SubmitDesignRevisionCommand(string RevisionId) : ICommand<Unit>;
```

Create `Commands/ApproveDesignRevisionCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record ApproveDesignRevisionCommand(string RevisionId, string? Reason) : ICommand<Unit>;
```

Create `Commands/RejectDesignRevisionCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record RejectDesignRevisionCommand(string RevisionId, string Reason) : ICommand<Unit>;
```

> `Unit` is `WaterPlatform.BuildingBlocks.Application.Commands.Unit` — same type used by `UpdateDraftGeometryCommand`.

- [ ] **Step 4: Create the handlers**

Create `Commands/SubmitDesignRevisionCommandHandler.cs`:

```csharp
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class SubmitDesignRevisionCommandHandler(
    IDesignRevisionRepository revisions,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<SubmitDesignRevisionCommand, Unit>
{
    public async Task<Unit> HandleAsync(SubmitDesignRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        var ctx = requestContextProvider.Current();
        revision.Submit(ctx?.UserId ?? "unknown", ctx?.CorrelationId);
        await revisions.SaveAsync(revision, ct);
        return Unit.Value;
    }
}
```

Create `Commands/ApproveDesignRevisionCommandHandler.cs`:

```csharp
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class ApproveDesignRevisionCommandHandler(
    IDesignRevisionRepository revisions,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<ApproveDesignRevisionCommand, Unit>
{
    public async Task<Unit> HandleAsync(ApproveDesignRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        var ctx = requestContextProvider.Current();
        revision.Approve(ctx?.UserId ?? "unknown", command.Reason, ctx?.CorrelationId);
        await revisions.SaveAsync(revision, ct);
        return Unit.Value;
    }
}
```

Create `Commands/RejectDesignRevisionCommandHandler.cs`:

```csharp
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class RejectDesignRevisionCommandHandler(
    IDesignRevisionRepository revisions,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<RejectDesignRevisionCommand, Unit>
{
    public async Task<Unit> HandleAsync(RejectDesignRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        var ctx = requestContextProvider.Current();
        revision.Reject(ctx?.UserId ?? "unknown", command.Reason, ctx?.CorrelationId);
        await revisions.SaveAsync(revision, ct);
        return Unit.Value;
    }
}
```

- [ ] **Step 5: Create the command validator**

Create `Validators/RejectDesignRevisionCommandValidator.cs`:

```csharp
using FluentValidation;
using WaterNetwork.Design.Application.Commands;

namespace WaterNetwork.Design.Application.Validators;

public sealed class RejectDesignRevisionCommandValidator : AbstractValidator<RejectDesignRevisionCommand>
{
    public RejectDesignRevisionCommandValidator()
    {
        RuleFor(x => x.RevisionId).NotEmpty();
        RuleFor(x => x.Reason).NotEmpty().WithMessage("A reason is required when rejecting a revision.");
    }
}
```

> Command validators are auto-registered: `Program.cs` calls `AddValidatorsFromAssembly(typeof(CreateDesignProjectCommand).Assembly)` (the Application assembly). No DI change needed.

- [ ] **Step 6: Add the transition DTO and extend the detail DTO**

Create `Dtos/RevisionTransitionDto.cs`:

```csharp
namespace WaterNetwork.Design.Application.Dtos;

public sealed record RevisionTransitionDto(
    string FromStatus,
    string ToStatus,
    string ActorId,
    string? Reason,
    string? CorrelationId,
    DateTime OccurredAt);
```

Replace `Dtos/DesignRevisionDetailDto.cs`:

```csharp
namespace WaterNetwork.Design.Application.Dtos;

public sealed record DesignRevisionDetailDto(
    string Id,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string Status,
    ValidationResultDto? ValidationResult,
    IReadOnlyList<RevisionTransitionDto> Transitions);
```

- [ ] **Step 7: Extend the read DAO port and implementation**

In `Ports/IDesignRevisionReadDao.cs` add a method to the interface:

```csharp
    Task<IReadOnlyList<RevisionTransitionDto>> ListTransitionsAsync(
        string tenantId, string revisionId, CancellationToken ct = default);
```

(ensure `using WaterNetwork.Design.Application.Dtos;` is present.)

In `Repositories/DesignRevisionReadDao.cs`: update `GetDetailAsync` to populate `Transitions`, and add `ListTransitionsAsync`. Replace the `return new DesignRevisionDetailDto(...)` line in `GetDetailAsync` with:

```csharp
        var transitions = await ListTransitionsAsync(tenantId, revisionId, ct);
        return new DesignRevisionDetailDto(m.Id, m.ProjectId, m.TenantId, m.RevisionNumber, m.Status, validation, transitions);
```

Add the method (inside the class):

```csharp
    public async Task<IReadOnlyList<RevisionTransitionDto>> ListTransitionsAsync(
        string tenantId, string revisionId, CancellationToken ct = default)
    {
        var rows = await dbContext.Set<DesignRevisionTransitionPersistenceModel>().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RevisionId == revisionId)
            .OrderBy(x => x.OccurredAt).ThenBy(x => x.Id)
            .ToListAsync(ct);

        return rows.Select(x => new RevisionTransitionDto(
            x.FromStatus, x.ToStatus, x.ActorId, x.Reason, x.CorrelationId, x.OccurredAt)).ToList();
    }
```

- [ ] **Step 8: Run the validator test to verify it passes + build**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --filter "FullyQualifiedName~RejectDesignRevisionCommandValidatorTests"`
Expected: PASS.

Run: `dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj`
Expected: BUILD SUCCEEDED, 0 warnings. (Handlers auto-registered via `AddHandlersFromAssembly`.)

- [ ] **Step 9: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application \
        src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/RejectDesignRevisionCommandValidatorTests.cs
git commit -m "feat(design): DSN-3 submit/approve/reject commands + transition read model (DSN-3)"
```

---

## Task 5: API endpoints + draft-mutation guard + integration E2E

**Files:**
- Modify: `.../WaterNetwork.Design.Api/Endpoints/RevisionsEndpointModule.cs`
- Create: `.../WaterNetwork.Design.Contracts/Requests/ApproveRevisionRequest.cs`
- Create: `.../WaterNetwork.Design.Contracts/Requests/RejectRevisionRequest.cs`
- Create: `.../WaterNetwork.Design.Api/Validators/RejectRevisionRequestValidator.cs`
- Modify: `.../WaterNetwork.Design.Application/Commands/CreateDraftAssetCommandHandler.cs`
- Modify: `.../WaterNetwork.Design.Application/Commands/CreateDraftAssetsBatchCommandHandler.cs`
- Modify: `.../WaterNetwork.Design.Application/Commands/UpdateDraftGeometryCommandHandler.cs`
- Test: `src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/DesignRevisionApprovalApiTests.cs`

- [ ] **Step 1: Write the failing integration tests**

Create `DesignRevisionApprovalApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignRevisionApprovalApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId = "tenant-1", bool canApprove = true)
    {
        var perms = canApprove
            ? new[] { "network-design:write", "network-design:read", "network-design:approve" }
            : new[] { "network-design:write", "network-design:read" };
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId, permissions: perms);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static object NodeBody(string code) => new
    {
        kind = "Node",
        assetCode = code,
        clientRef = (string?)null,
        geometry = new { type = "Point", coordinates = new[] { new[] { 105.8, 21.0 } } },
        attributes = new Dictionary<string, string> { ["nodeType"] = "Junction" }
    };

    private static async Task<(string projectId, string revisionId)> ValidatedRevision(HttpClient client)
    {
        var proj = await client.PostAsJsonAsync("/api/design/projects", new { name = "Appr-" + Guid.CreateVersion7() });
        var projectId = (await proj.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        var rev = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        var revisionId = (await rev.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-1"));
        var validate = await client.PostAsync($"/api/design/revisions/{revisionId}/validate", null);
        validate.StatusCode.Should().Be(HttpStatusCode.OK);
        return (projectId, revisionId);
    }

    [Fact]
    public async Task Submit_Then_Approve_Happy_Path()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var (_, revisionId) = await ValidatedRevision(client);

        var submit = await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);
        submit.StatusCode.Should().Be(HttpStatusCode.OK);

        var approve = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/approve", new { reason = "ok" });
        approve.StatusCode.Should().Be(HttpStatusCode.OK);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/design/revisions/{revisionId}");
        detail!["status"]!.GetValue<string>().Should().Be("Approved");
        detail["transitions"]!.AsArray().Count.Should().Be(2);
    }

    [Fact]
    public async Task Submit_Then_Reject_Returns_To_Draft_With_Reason()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var (_, revisionId) = await ValidatedRevision(client);
        await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);

        var reject = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/reject", new { reason = "missing elevation" });
        reject.StatusCode.Should().Be(HttpStatusCode.OK);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/design/revisions/{revisionId}");
        detail!["status"]!.GetValue<string>().Should().Be("Draft");
        detail["transitions"]!.AsArray().Should()
            .Contain(t => t!["toStatus"]!.GetValue<string>() == "Draft" && t["reason"]!.GetValue<string>() == "missing elevation");
    }

    [Fact]
    public async Task Submit_From_Draft_Is_Unprocessable()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var proj = await client.PostAsJsonAsync("/api/design/projects", new { name = "Draft-" + Guid.CreateVersion7() });
        var projectId = (await proj.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        var rev = await client.PostAsync($"/api/design/projects/{projectId}/revisions", null);
        var revisionId = (await rev.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var submit = await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);
        submit.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Approve_Without_Permission_Is_Forbidden()
    {
        using var factory = new DesignApiFactory(postgis);
        using var writer = Client(factory, canApprove: true);
        var (_, revisionId) = await ValidatedRevision(writer);
        await writer.PostAsync($"/api/design/revisions/{revisionId}/submit", null);

        using var noApprove = Client(factory, canApprove: false);
        var approve = await noApprove.PostAsJsonAsync($"/api/design/revisions/{revisionId}/approve", new { reason = "x" });
        approve.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Reject_Without_Reason_Is_BadRequest()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var (_, revisionId) = await ValidatedRevision(client);
        await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);

        var reject = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/reject", new { reason = "" });
        reject.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Submit_Cross_Tenant_Is_NotFound()
    {
        using var factory = new DesignApiFactory(postgis);
        using var a = Client(factory, "tenant-A");
        var (_, revisionId) = await ValidatedRevision(a);

        using var b = Client(factory, "tenant-B");
        var submit = await b.PostAsync($"/api/design/revisions/{revisionId}/submit", null);
        submit.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Draft_Mutation_Blocked_After_Submit()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory);
        var (_, revisionId) = await ValidatedRevision(client);
        await client.PostAsync($"/api/design/revisions/{revisionId}/submit", null);

        var addDraft = await client.PostAsJsonAsync($"/api/design/revisions/{revisionId}/draft-assets", NodeBody("N-2"));
        addDraft.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj --filter "FullyQualifiedName~DesignRevisionApprovalApiTests"`
Expected: FAIL — endpoints return 404 (not mapped) / draft mutation still allowed (200). (Requires Docker for PostGIS Testcontainer.)

- [ ] **Step 3: Create the request records**

Create `Contracts/Requests/ApproveRevisionRequest.cs`:

```csharp
namespace WaterNetwork.Design.Contracts.Requests;

public sealed record ApproveRevisionRequest(string? Reason);
```

Create `Contracts/Requests/RejectRevisionRequest.cs`:

```csharp
namespace WaterNetwork.Design.Contracts.Requests;

public sealed record RejectRevisionRequest(string Reason);
```

- [ ] **Step 4: Create the request validator (400 on missing reject reason)**

Create `Api/Validators/RejectRevisionRequestValidator.cs`:

```csharp
using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class RejectRevisionRequestValidator : AbstractValidator<RejectRevisionRequest>
{
    public RejectRevisionRequestValidator()
    {
        RuleFor(x => x.Reason).NotEmpty().WithMessage("A reason is required when rejecting a revision.");
    }
}
```

- [ ] **Step 5: Map the three endpoints**

In `Api/Endpoints/RevisionsEndpointModule.cs`: add `using WaterNetwork.Design.Contracts.Requests;` and `using WaterPlatform.BuildingBlocks.WebApi.Validation;`. Inside `MapEndpoints`, after the existing `group.MapPost("/{revisionId}/validate", ...)` block, add:

```csharp
        // Submit a Validated revision for approval.
        group.MapPost("/{revisionId}/submit", async (
                string revisionId, ICommandBus bus, IQueryBus queries, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new SubmitDesignRevisionCommand(revisionId), ct);
                var dto = await queries.ExecuteAsync(new GetDesignRevisionDetailQuery(revisionId), ct);
                return Results.Ok(dto);
            })
            .RequirePermission("network-design:write");

        // Approve a Submitted revision (optional reason).
        group.MapPost("/{revisionId}/approve", async (
                string revisionId, ApproveRevisionRequest? request, ICommandBus bus, IQueryBus queries, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ApproveDesignRevisionCommand(revisionId, request?.Reason), ct);
                var dto = await queries.ExecuteAsync(new GetDesignRevisionDetailQuery(revisionId), ct);
                return Results.Ok(dto);
            })
            .RequirePermission("network-design:approve");

        // Reject a Submitted revision (reason required) → back to Draft.
        group.MapPost("/{revisionId}/reject", async (
                string revisionId, RejectRevisionRequest request, ICommandBus bus, IQueryBus queries, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new RejectDesignRevisionCommand(revisionId, request.Reason), ct);
                var dto = await queries.ExecuteAsync(new GetDesignRevisionDetailQuery(revisionId), ct);
                return Results.Ok(dto);
            })
            .WithValidation<RejectRevisionRequest>()
            .RequirePermission("network-design:approve");
```

Ensure `using WaterNetwork.Design.Application.Commands;` is present (the file already imports Application.Queries/Dtos and Application.Commands). The `IQueryBus` lives in `WaterPlatform.BuildingBlocks.Application.Queries` (already imported).

- [ ] **Step 6: Add the draft-mutation guard to the three draft handlers**

In `Application/Commands/CreateDraftAssetCommandHandler.cs`, after the tenant/null check (`throw NotFoundException...`) and BEFORE the `if (revision.Status == DesignRevisionStatus.Validated)` block, insert:

```csharp
        revision.EnsureDraftsEditable();
```

In `Application/Commands/CreateDraftAssetsBatchCommandHandler.cs`, same insertion point (after the `NotFoundException` throw, before the `if (revision.Status == DesignRevisionStatus.Validated)` block):

```csharp
        revision.EnsureDraftsEditable();
```

In `Application/Commands/UpdateDraftGeometryCommandHandler.cs`, restructure so the revision is loaded and guarded BEFORE mutating the draft. Replace the method body from the `draft.UpdateGeometry(...)` line onward:

```csharp
        var revision = await revisions.GetByIdAsync(draft.RevisionId, ct);
        revision?.EnsureDraftsEditable();

        draft.UpdateGeometry(DraftGeometryFactory.FromInput(command.Geometry));
        await drafts.UpdateAsync(draft, ct);

        // A draft change invalidates a previously-Validated revision.
        if (revision is { Status: DesignRevisionStatus.Validated })
        {
            revision.MarkDraftsChanged();
            await revisions.SaveAsync(revision, ct);
        }

        return Unit.Value;
```

- [ ] **Step 7: Run the integration tests to verify they pass**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj --filter "FullyQualifiedName~DesignRevisionApprovalApiTests"`
Expected: PASS (all 7). Requires Docker running.

- [ ] **Step 8: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Api \
        src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/Requests \
        src/services/water-network-design-be/src/WaterNetwork.Design.Application/Commands \
        src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/DesignRevisionApprovalApiTests.cs
git commit -m "feat(design): DSN-3 approval endpoints + draft-edit guard + E2E (DSN-3)"
```

---

## Task 6: Docs, decision record, full green

**Files:**
- Create: `docs/decisions/0014-design-approval-permission-and-audit.md`
- Modify: `docs/conventions/event-catalog.md`
- Modify: `docs/stories/backlog.md`
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` (tick DSN-3)

- [ ] **Step 1: Write the decision record**

Create `docs/decisions/0014-design-approval-permission-and-audit.md`:

```markdown
# 0014 — Design revision approval: permission enforcement + audit trail

**Status:** accepted
**Date:** 2026-06-16
**Slice:** DSN-3 (US-P2-05); first activation of cross-cutting US-X-01.

## Context

DSN-3 introduces the first permission-sensitive action in the platform (approving a
design revision) and the first per-transition audit requirement.

## Decision

1. **Policy naming `<context>:<action>`.** Approval/rejection require `network-design:approve`;
   submit requires `network-design:write`. Enforced at the endpoint via
   `RequirePermission(...)` (claim `permission`), the helper in `BuildingBlocks.Security`.
2. **Audit via append-only table.** Every revision transition is recorded in
   `design_revision_transitions` (`from`/`to`/`actorId`/`reason`/`correlationId`/`occurredAt`),
   mirroring `asset_lifecycle_entries`. Never updated or deleted.
3. **Actor sentinel.** When the request carries no `UserId` claim, the actor is recorded as
   `"unknown"` (clearer for audit than reusing the tenant id; supersedes the DSN-1 fallback).
4. **Reject returns to Draft.** Rejection moves the revision back to `Draft` and clears
   `ValidationResult`, forcing re-validation after edits. Reason is mandatory on reject.
5. **Tenant scope.** Cross-tenant access yields 404 (load is tenant-scoped, hides id-enumeration).

## Consequences

- Keycloak real roles are out of scope (deferred per roadmap §15.2); Mock JWT carries the claim.
- DSN-4 will consume `design.revision.approved` to trigger publish→GIS.
```

- [ ] **Step 2: Append events to the event catalog**

In `docs/conventions/event-catalog.md`, append three rows to the registry table. The table columns are: `eventType` (backticked) | version (`v1`) | producer (full service name) | consumers | payload record (backticked) | status. Append:

```markdown
| `design.revision.submitted` | v1 | water-network-design-be | (none yet) | `DesignRevisionSubmittedV1` | shipped (DSN-3) |
| `design.revision.approved` | v1 | water-network-design-be | water-network-design-be (DSN-4 publish trigger) [planned] | `DesignRevisionApprovedV1` | shipped (DSN-3) |
| `design.revision.rejected` | v1 | water-network-design-be | (none yet) | `DesignRevisionRejectedV1` | shipped (DSN-3) |
```

> Note: DSN-1/DSN-2 design events are not yet in the catalog. Adding the DSN-3 rows is sufficient for this slice; optionally backfill `design.project.created` / `design.document.uploaded` / `design.revision.created` / `design.revision.validated` while here (non-blocking).

- [ ] **Step 3: Update backlog + roadmap**

In `docs/stories/backlog.md`, change the Phase 2 row status note to include DSN-3 done, and add a "Follow-up sau DSN-3" section capturing: (a) DSN-4 consumes `design.revision.approved`; (b) no consumers yet for submitted/rejected; (c) approval reason optional / submit has no reason.

In `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §3.3, mark the DSN-3 row done (append ` ✓` to "DSN-3 Submit/Approve/Reject revision" like the other shipped slices) and in §7.3 mark item 3 (DSN-3) as SHIPPED.

- [ ] **Step 4: Run the full design-be test suite (all three projects)**

Run:
```bash
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj
```
Expected: all PASS, 0 warnings. (Integration requires Docker.)

- [ ] **Step 5: Verify compose still parses**

Run: `docker compose -f docker-compose.yml config --quiet` (compose lives at repo root)
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0014-design-approval-permission-and-audit.md docs/conventions/event-catalog.md \
        docs/stories/backlog.md docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md
git commit -m "docs(design): DSN-3 decision record + event catalog + backlog (DSN-3)"
```

---

## Self-Review Notes (filled by plan author)

- **Spec coverage:** enum (T1) ✓; transition methods + guard (T1) ✓; transition entity/table (T1/T2) ✓; commands+handlers+validators (T4) ✓; endpoints + permissions (T5) ✓; events + contract tests (T3) ✓; read model history (T4) ✓; draft-mutation guard (T1 domain + T5 wiring) ✓; tenant-scope 404 (T4 handlers, T5 test) ✓; decision record + catalog (T6) ✓; DoD test matrix (T1 unit, T3 contract, T5 integration) ✓.
- **Deviation logged:** spec's `_newTransitions` sketch → canonical EF nav + `Skip(count)` pattern (mirrors asset-be); reason documented in header.
- **Type consistency:** `Reconstitute(..., IEnumerable<DesignRevisionTransition> transitions)` defined in T1, consumed in T2 repo `ToDomain`. `EnsureDraftsEditable()` defined T1, called T5. `Unit` from `BuildingBlocks.Application.Commands`. `RevisionTransitionDto` defined T4, used in `DesignRevisionDetailDto` (T4) + ReadDao (T4). Event types `RevisionSubmitted/Approved/Rejected` const (T3) used by mapper (T3) + contract test (T3). Status values `Submitted`/`Approved` (T1) used across.
```
