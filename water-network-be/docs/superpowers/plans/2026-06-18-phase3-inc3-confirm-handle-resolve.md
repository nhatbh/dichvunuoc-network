# INC-3 Confirm / Handle / Resolve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `ConfirmIsolationPlan → StartIncidentHandling → ResolveIncident` lifecycle to `water-network-incident-be`, emitting `incident.isolation-plan-confirmed`, `maintenance.work-order-requested`, and `incident.resolved` — closing Phase 3 and freezing the Phase 4 work-order contract.

**Architecture:** Extend the `NetworkIncident` aggregate with three linear, isolation-first transitions, each paired with one domain event (decision-0023 invariant: a `Version` bump must carry a domain event). Events flow through the existing outbox + `IncidentIntegrationEventMapper`; no new DI wiring or schema migration is needed (status persists as a ≤32-char string; domain events are auto-scanned by `AddOutboxDomainEventTypesFromAssembly`).

**Tech Stack:** .NET (C#), EF Core + Npgsql/NetTopologySuite, FluentValidation, xUnit + FluentAssertions, minimal APIs.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-inc3-confirm-handle-resolve-design.md`.
- TDD mandatory; slice exit: `dotnet test` green, **0 warnings**, conventional commit (CLAUDE.md / decision 0008).
- Every aggregate transition that bumps `Version` MUST call `MarkAsModified()` **and** `AddDomainEvent(...)` exactly once (decision 0023). All three new transitions emit an event, so all three do both.
- Mutation handlers load tenant-scoped and 404 on tenant mismatch: `if (incident is null || incident.TenantId != tenant.TenantId) throw NotFoundException.Entity("NetworkIncident", id)` (US-X-01 / decision 0016 pattern, already used by `ClassifyIncidentCommandHandler`).
- `BusinessRuleException` → HTTP **422**; `NotFoundException` → **404** (`GlobalExceptionMiddleware`).
- Frozen contract — `maintenance.work-order-requested` v1 = exactly `{ IncidentId, AssetRefs[]{AssetId,Kind}, Summary, Severity }`. Do not add fields in this slice.
- Run tests from the service dir: `cd src/services/water-network-incident-be`. Run a single project, never `.slnx` (SDK footgun: `.slnx` silently runs 0 tests — backlog note).

---

### Task 1: Domain enums + `IsolationPlan.AsConfirmed()`

**Files:**
- Modify: `src/WaterNetwork.Incident.Domain/ValueObjects/IncidentStatus.cs`
- Modify: `src/WaterNetwork.Incident.Domain/ValueObjects/IsolationPlanStatus.cs`
- Modify: `src/WaterNetwork.Incident.Domain/ValueObjects/TimelineEntryType.cs`
- Modify: `src/WaterNetwork.Incident.Domain/Entities/IsolationPlan.cs`
- Test: `tests/WaterNetwork.Incident.UnitTests/IsolationPlanTests.cs`

**Interfaces:**
- Produces: `IncidentStatus.{IsolationConfirmed,InProgress,Resolved}`, `IsolationPlanStatus.Confirmed`, `TimelineEntryType.{IsolationConfirmed,HandlingStarted,Resolved}`, `IsolationPlan.AsConfirmed() : IsolationPlan` (only valid on a `Proposed` plan).

- [ ] **Step 1: Write the failing test** — append to `IsolationPlanTests.cs`:

```csharp
[Fact]
public void AsConfirmed_From_Proposed_Sets_Confirmed()
{
    var plan = IsolationPlan.Proposed("inc-1", "node-1", 7, ["v1"], ["node-1"], ["p1"], sequence: 0);
    var confirmed = plan.AsConfirmed();
    confirmed.Status.Should().Be(IsolationPlanStatus.Confirmed);
    confirmed.Id.Should().Be(plan.Id);
}

[Fact]
public void AsConfirmed_From_NonProposed_Throws()
{
    var plan = IsolationPlan.Failed("inc-1", "node-1", "boom", sequence: 0);
    plan.Invoking(p => p.AsConfirmed()).Should().Throw<InvalidOperationException>();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter AsConfirmed`
Expected: FAIL — `IsolationPlanStatus.Confirmed` and `AsConfirmed` do not exist (compile error).

- [ ] **Step 3: Add enum members.**

`IncidentStatus.cs` — add the three members:

```csharp
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
```

`IsolationPlanStatus.cs` — add `Confirmed`:

```csharp
public enum IsolationPlanStatus
{
    Proposed,
    AnalysisFailed,
    Superseded,
    Confirmed
}
```

`TimelineEntryType.cs` — add the three members:

```csharp
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
```

- [ ] **Step 4: Add `AsConfirmed()`** to `IsolationPlan.cs`, right after `AsSuperseded()`:

```csharp
public IsolationPlan AsConfirmed()
{
    if (Status != IsolationPlanStatus.Proposed)
        throw new InvalidOperationException($"Only a Proposed plan can be confirmed; current status is {Status}.");
    return this with { Status = IsolationPlanStatus.Confirmed };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter AsConfirmed`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/IsolationPlanTests.cs
git commit -m "feat(inc3): add confirm/handle/resolve enum states and IsolationPlan.AsConfirmed"
```

---

### Task 2: `ConfirmIsolationPlan` command + `IncidentIsolationPlanConfirmed` domain event

**Files:**
- Create: `src/WaterNetwork.Incident.Domain/DomainEvents/IncidentAssetRefData.cs`
- Create: `src/WaterNetwork.Incident.Domain/DomainEvents/IncidentIsolationPlanConfirmed.cs`
- Modify: `src/WaterNetwork.Incident.Domain/Aggregates/NetworkIncident.cs`
- Test: `tests/WaterNetwork.Incident.UnitTests/NetworkIncidentIsolationTests.cs`

**Interfaces:**
- Consumes: `IsolationPlan.AsConfirmed()`, `IncidentStatus.IsolationConfirmed`, `IsolationPlanStatus.Confirmed`, `TimelineEntryType.IsolationConfirmed` (Task 1).
- Produces:
  - `IncidentAssetRefData(string AssetId, string Kind)` — shared domain-event ref record (also used by Task 3).
  - `IncidentIsolationPlanConfirmedData(string TenantId, string PlanId, long GraphVersion, IReadOnlyList<string> ValvesToClose, IReadOnlyList<string> IsolatedNodes, IReadOnlyList<string> IsolatedPipes, IReadOnlyList<IncidentAssetRefData> AffectedRefs, string ConfirmedBy)`.
  - `IncidentIsolationPlanConfirmed(string AggregateId, IncidentIsolationPlanConfirmedData Data)` with `eventType: "IncidentIsolationPlanConfirmed"`.
  - `NetworkIncident.ConfirmIsolationPlan(string actorId, string? note)`.

- [ ] **Step 1: Write the failing test** — append to `NetworkIncidentIsolationTests.cs`. Add a helper that walks to `IsolationPlanReady`, then the tests:

```csharp
private static NetworkIncident PlanReady()
{
    var i = Classified();
    i.RequestIsolationAnalysis("node-1", "operator-1");
    i.RecordIsolationPlan(5, ["v1"], ["node-1"], ["p1"], "operator-1");
    return i;
}

[Fact]
public void ConfirmIsolationPlan_From_PlanReady_Confirms_Plan_And_Emits_Event()
{
    var i = PlanReady();
    i.ClearDomainEvents();

    i.ConfirmIsolationPlan("operator-1", note: null);

    i.Status.Should().Be(IncidentStatus.IsolationConfirmed);
    i.IsolationPlans.Should().ContainSingle(p => p.Status == IsolationPlanStatus.Confirmed);
    i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.IsolationConfirmed);
    i.GetDomainEvents().Should().ContainSingle(e => e is IncidentIsolationPlanConfirmed);
}

[Fact]
public void ConfirmIsolationPlan_From_Classified_Throws()
{
    var i = Classified();
    i.Invoking(x => x.ConfirmIsolationPlan("op", null)).Should().Throw<BusinessRuleException>();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter ConfirmIsolationPlan`
Expected: FAIL — `ConfirmIsolationPlan` / `IncidentIsolationPlanConfirmed` do not exist (compile error).

- [ ] **Step 3: Create `IncidentAssetRefData.cs`:**

```csharp
namespace WaterNetwork.Incident.Domain.DomainEvents;

/// <summary>Minimal asset reference carried by INC-3 domain events (id + kind only).</summary>
public sealed record IncidentAssetRefData(string AssetId, string Kind);
```

- [ ] **Step 4: Create `IncidentIsolationPlanConfirmed.cs`:**

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentIsolationPlanConfirmedData(
    string TenantId,
    string PlanId,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    IReadOnlyList<IncidentAssetRefData> AffectedRefs,
    string ConfirmedBy);

public sealed record IncidentIsolationPlanConfirmed(string AggregateId, IncidentIsolationPlanConfirmedData Data)
    : DomainEventBase<IncidentIsolationPlanConfirmedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentIsolationPlanConfirmed",
        data: Data);
```

- [ ] **Step 5: Add `ConfirmIsolationPlan`** to `NetworkIncident.cs` (after `RecordAnalysisFailure`):

```csharp
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter ConfirmIsolationPlan`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/NetworkIncidentIsolationTests.cs
git commit -m "feat(inc3): ConfirmIsolationPlan transition + IncidentIsolationPlanConfirmed event"
```

---

### Task 3: `StartIncidentHandling` command + `WorkOrderRequested` domain event

**Files:**
- Create: `src/WaterNetwork.Incident.Domain/DomainEvents/WorkOrderRequested.cs`
- Modify: `src/WaterNetwork.Incident.Domain/Aggregates/NetworkIncident.cs`
- Test: `tests/WaterNetwork.Incident.UnitTests/NetworkIncidentIsolationTests.cs`

**Interfaces:**
- Consumes: `IncidentStatus.IsolationConfirmed/InProgress`, `TimelineEntryType.HandlingStarted`, `IncidentAssetRefData` (Task 2), `ConfirmIsolationPlan` (Task 2).
- Produces:
  - `WorkOrderRequestedData(IReadOnlyList<IncidentAssetRefData> AssetRefs, string Summary, int Severity)`.
  - `WorkOrderRequested(string AggregateId, WorkOrderRequestedData Data)` with `eventType: "WorkOrderRequested"`.
  - `NetworkIncident.StartIncidentHandling(string actorId, string? note)`.

- [ ] **Step 1: Write the failing test** — append to `NetworkIncidentIsolationTests.cs`:

```csharp
[Fact]
public void StartIncidentHandling_From_Confirmed_Moves_To_InProgress_And_Emits_WorkOrder()
{
    var i = PlanReady();
    i.ConfirmIsolationPlan("operator-1", null);
    i.ClearDomainEvents();

    i.StartIncidentHandling("operator-1", note: null);

    i.Status.Should().Be(IncidentStatus.InProgress);
    i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.HandlingStarted);
    var evt = i.GetDomainEvents().OfType<WorkOrderRequested>().Should().ContainSingle().Subject;
    evt.Data.Severity.Should().Be(3);
    evt.Data.Summary.Should().Be("PipeBurst severity 3");
    evt.Data.AssetRefs.Should().ContainSingle(r => r.AssetId == "node-1" && r.Kind == "Node");
}

[Fact]
public void StartIncidentHandling_From_PlanReady_Throws()
{
    var i = PlanReady();
    i.Invoking(x => x.StartIncidentHandling("op", null)).Should().Throw<BusinessRuleException>();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter StartIncidentHandling`
Expected: FAIL — `StartIncidentHandling` / `WorkOrderRequested` do not exist (compile error).

- [ ] **Step 3: Create `WorkOrderRequested.cs`:**

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record WorkOrderRequestedData(
    IReadOnlyList<IncidentAssetRefData> AssetRefs,
    string Summary,
    int Severity);

public sealed record WorkOrderRequested(string AggregateId, WorkOrderRequestedData Data)
    : DomainEventBase<WorkOrderRequestedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "WorkOrderRequested",
        data: Data);
```

- [ ] **Step 4: Add `StartIncidentHandling`** to `NetworkIncident.cs` (after `ConfirmIsolationPlan`):

```csharp
public void StartIncidentHandling(string actorId, string? note)
{
    if (Status != IncidentStatus.IsolationConfirmed)
        throw BusinessRuleException.Violation("InvalidIncidentTransition",
            $"[InvalidIncidentTransition] Cannot start handling from status {Status}.");

    Status = IncidentStatus.InProgress;
    AppendTimeline(TimelineEntryType.HandlingStarted, actorId, note);
    MarkAsModified();
    AddDomainEvent(new WorkOrderRequested(Id, new WorkOrderRequestedData(
        _affectedRefs.Select(r => new IncidentAssetRefData(r.AssetId, r.Kind.ToString())).ToList(),
        $"{Category} severity {Severity}",
        Severity)));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter StartIncidentHandling`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/NetworkIncidentIsolationTests.cs
git commit -m "feat(inc3): StartIncidentHandling transition + WorkOrderRequested event"
```

---

### Task 4: `ResolveIncident` command + `IncidentResolved` domain event

**Files:**
- Create: `src/WaterNetwork.Incident.Domain/DomainEvents/IncidentResolved.cs`
- Modify: `src/WaterNetwork.Incident.Domain/Aggregates/NetworkIncident.cs`
- Test: `tests/WaterNetwork.Incident.UnitTests/NetworkIncidentIsolationTests.cs`

**Interfaces:**
- Consumes: `IncidentStatus.InProgress/Resolved`, `TimelineEntryType.Resolved`, `StartIncidentHandling` (Task 3).
- Produces:
  - `IncidentResolvedData(string TenantId, string ResolvedBy, string? ResolutionNote)`.
  - `IncidentResolved(string AggregateId, IncidentResolvedData Data)` with `eventType: "IncidentResolved"`.
  - `NetworkIncident.ResolveIncident(string actorId, string? resolutionNote)`.

- [ ] **Step 1: Write the failing test** — append to `NetworkIncidentIsolationTests.cs`:

```csharp
[Fact]
public void ResolveIncident_From_InProgress_Moves_To_Resolved_And_Emits_Event()
{
    var i = PlanReady();
    i.ConfirmIsolationPlan("operator-1", null);
    i.StartIncidentHandling("operator-1", null);
    i.ClearDomainEvents();

    i.ResolveIncident("operator-1", resolutionNote: "fixed");

    i.Status.Should().Be(IncidentStatus.Resolved);
    i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.Resolved);
    i.GetDomainEvents().Should().ContainSingle(e => e is IncidentResolved);
}

[Fact]
public void ResolveIncident_From_Confirmed_Throws()
{
    var i = PlanReady();
    i.ConfirmIsolationPlan("operator-1", null);
    i.Invoking(x => x.ResolveIncident("op", null)).Should().Throw<BusinessRuleException>();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter ResolveIncident`
Expected: FAIL — `ResolveIncident` / `IncidentResolved` do not exist (compile error).

- [ ] **Step 3: Create `IncidentResolved.cs`:**

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentResolvedData(
    string TenantId,
    string ResolvedBy,
    string? ResolutionNote);

public sealed record IncidentResolved(string AggregateId, IncidentResolvedData Data)
    : DomainEventBase<IncidentResolvedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentResolved",
        data: Data);
```

- [ ] **Step 4: Add `ResolveIncident`** to `NetworkIncident.cs` (after `StartIncidentHandling`):

```csharp
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter ResolveIncident`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/NetworkIncidentIsolationTests.cs
git commit -m "feat(inc3): ResolveIncident transition + IncidentResolved event"
```

---

### Task 5: Contracts (event types + v1 records) + contract tests

**Files:**
- Modify: `src/WaterNetwork.Incident.Contracts/IncidentEventTypes.cs`
- Create: `src/WaterNetwork.Incident.Contracts/Events/IncidentAssetRefV1.cs`
- Create: `src/WaterNetwork.Incident.Contracts/Events/IncidentIsolationPlanConfirmedV1.cs`
- Create: `src/WaterNetwork.Incident.Contracts/Events/WorkOrderRequestedV1.cs`
- Create: `src/WaterNetwork.Incident.Contracts/Events/IncidentResolvedV1.cs`
- Test: `tests/WaterNetwork.Incident.ContractTests/IncidentEventsContractTests.cs`

**Interfaces:**
- Produces:
  - `IncidentEventTypes.IsolationPlanConfirmed = "incident.isolation-plan-confirmed"`, `.Resolved = "incident.resolved"`, `.WorkOrderRequested = "maintenance.work-order-requested"`.
  - `IncidentAssetRefV1(string AssetId, string Kind)`.
  - `IncidentIsolationPlanConfirmedV1(string IncidentId, string TenantId, string PlanId, long GraphVersion, IReadOnlyList<string> ValvesToClose, IReadOnlyList<string> IsolatedNodes, IReadOnlyList<string> IsolatedPipes, IReadOnlyList<IncidentAssetRefV1> AffectedRefs, string ConfirmedBy)`.
  - `WorkOrderRequestedV1(string IncidentId, IReadOnlyList<IncidentAssetRefV1> AssetRefs, string Summary, int Severity)`.
  - `IncidentResolvedV1(string IncidentId, string TenantId, string ResolvedBy, string? ResolutionNote)`.

- [ ] **Step 1: Write the failing tests** — append to `IncidentEventsContractTests.cs`:

```csharp
[Fact]
public void Inc3_Event_Types_Are_Fixed()
{
    IncidentEventTypes.IsolationPlanConfirmed.Should().Be("incident.isolation-plan-confirmed");
    IncidentEventTypes.Resolved.Should().Be("incident.resolved");
    IncidentEventTypes.WorkOrderRequested.Should().Be("maintenance.work-order-requested");
}

[Fact]
public void IncidentIsolationPlanConfirmed_V1_Schema_Is_Stable()
{
    var evt = new IncidentIsolationPlanConfirmedV1(
        "inc-1", "tenant-1", "plan-1", 9, ["v1"], ["node-1"], ["p1"],
        new[] { new IncidentAssetRefV1("node-1", "Node") }, "operator-1");
    var json = JsonSerializer.Serialize(evt);
    using var doc = JsonDocument.Parse(json);
    doc.RootElement.EnumerateObject().Select(p => p.Name)
        .Should().Equal("IncidentId", "TenantId", "PlanId", "GraphVersion",
            "ValvesToClose", "IsolatedNodes", "IsolatedPipes", "AffectedRefs", "ConfirmedBy");
}

[Fact]
public void WorkOrderRequested_V1_Schema_Is_Stable()
{
    var evt = new WorkOrderRequestedV1(
        "inc-1", new[] { new IncidentAssetRefV1("node-1", "Node") }, "PipeBurst severity 3", 3);
    var json = JsonSerializer.Serialize(evt);
    using var doc = JsonDocument.Parse(json);
    doc.RootElement.EnumerateObject().Select(p => p.Name)
        .Should().Equal("IncidentId", "AssetRefs", "Summary", "Severity");
    doc.RootElement.GetProperty("AssetRefs")[0].EnumerateObject().Select(p => p.Name)
        .Should().Equal("AssetId", "Kind");
}

[Fact]
public void IncidentResolved_V1_Schema_Is_Stable()
{
    var evt = new IncidentResolvedV1("inc-1", "tenant-1", "operator-1", "fixed");
    var json = JsonSerializer.Serialize(evt);
    using var doc = JsonDocument.Parse(json);
    doc.RootElement.EnumerateObject().Select(p => p.Name)
        .Should().Equal("IncidentId", "TenantId", "ResolvedBy", "ResolutionNote");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/WaterNetwork.Incident.ContractTests --filter "Inc3_Event_Types_Are_Fixed|V1_Schema_Is_Stable"`
Expected: FAIL — new constants/records do not exist (compile error).

- [ ] **Step 3: Extend `IncidentEventTypes.cs`** — add three constants inside the class:

```csharp
    public const string IsolationPlanConfirmed = "incident.isolation-plan-confirmed";
    public const string Resolved = "incident.resolved";
    // Phase 4 work-order contract, produced by incident-be (frozen v1).
    public const string WorkOrderRequested = "maintenance.work-order-requested";
```

- [ ] **Step 4: Create the four contract records.**

`IncidentAssetRefV1.cs`:

```csharp
namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>Minimal asset reference (id + kind) shared by INC-3 event payloads.</summary>
public sealed record IncidentAssetRefV1(string AssetId, string Kind);
```

`IncidentIsolationPlanConfirmedV1.cs`:

```csharp
namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.isolation-plan-confirmed</c> (INC-3, decision 0024).</summary>
public sealed record IncidentIsolationPlanConfirmedV1(
    string IncidentId,
    string TenantId,
    string PlanId,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    IReadOnlyList<IncidentAssetRefV1> AffectedRefs,
    string ConfirmedBy);
```

`WorkOrderRequestedV1.cs`:

```csharp
namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>maintenance.work-order-requested</c> — Phase 3→4 contract (INC-3, decision 0024). FROZEN: do not add fields.</summary>
public sealed record WorkOrderRequestedV1(
    string IncidentId,
    IReadOnlyList<IncidentAssetRefV1> AssetRefs,
    string Summary,
    int Severity);
```

`IncidentResolvedV1.cs`:

```csharp
namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.resolved</c> (INC-3, decision 0024).</summary>
public sealed record IncidentResolvedV1(
    string IncidentId,
    string TenantId,
    string ResolvedBy,
    string? ResolutionNote);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test tests/WaterNetwork.Incident.ContractTests --filter "Inc3_Event_Types_Are_Fixed|V1_Schema_Is_Stable"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Contracts \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests/IncidentEventsContractTests.cs
git commit -m "feat(inc3): freeze v1 contracts for confirmed/work-order-requested/resolved"
```

---

### Task 6: Integration-event mapper (domain → contract)

**Files:**
- Modify: `src/WaterNetwork.Incident.Infrastructure/IntegrationEvents/IncidentIntegrationEventMapper.cs`
- Test: `tests/WaterNetwork.Incident.UnitTests/IncidentIntegrationEventMapperTests.cs` (create)

**Interfaces:**
- Consumes: domain events (Tasks 2-4), contract records + event-type constants (Task 5), `IncidentAssetRefData` (Task 2).
- Produces: registry entries for `"IncidentIsolationPlanConfirmed"`, `"WorkOrderRequested"`, `"IncidentResolved"`; mapped integration events with the correct `EventType` constant and v1 payload. `CanMap` returns true for the three new event types.

- [ ] **Step 1: Write the failing test** — create `IncidentIntegrationEventMapperTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Incident.Contracts;
using WaterNetwork.Incident.Contracts.Events;
using WaterNetwork.Incident.Domain.DomainEvents;
using WaterNetwork.Incident.Infrastructure.IntegrationEvents;

namespace WaterNetwork.Incident.UnitTests;

public sealed class IncidentIntegrationEventMapperTests
{
    private readonly IncidentIntegrationEventMapper _mapper = new();

    [Fact]
    public void Maps_IsolationPlanConfirmed_To_V1()
    {
        var domain = new IncidentIsolationPlanConfirmed("inc-1", new IncidentIsolationPlanConfirmedData(
            "tenant-1", "plan-1", 9, ["v1"], ["node-1"], ["p1"],
            [new IncidentAssetRefData("node-1", "Node")], "operator-1"));

        _mapper.CanMap("IncidentIsolationPlanConfirmed").Should().BeTrue();
        var ie = _mapper.Map(domain)!;
        ie.EventType.Should().Be(IncidentEventTypes.IsolationPlanConfirmed);
        ie.Should().BeOfType<IncidentIsolationPlanConfirmedIntegrationEvent>()
            .Which.Data.Should().BeEquivalentTo(new IncidentIsolationPlanConfirmedV1(
                "inc-1", "tenant-1", "plan-1", 9, ["v1"], ["node-1"], ["p1"],
                [new IncidentAssetRefV1("node-1", "Node")], "operator-1"));
    }

    [Fact]
    public void Maps_WorkOrderRequested_To_V1()
    {
        var domain = new WorkOrderRequested("inc-1", new WorkOrderRequestedData(
            [new IncidentAssetRefData("node-1", "Node")], "PipeBurst severity 3", 3));

        var ie = _mapper.Map(domain)!;
        ie.EventType.Should().Be(IncidentEventTypes.WorkOrderRequested);
        ie.Should().BeOfType<WorkOrderRequestedIntegrationEvent>()
            .Which.Data.Should().BeEquivalentTo(new WorkOrderRequestedV1(
                "inc-1", [new IncidentAssetRefV1("node-1", "Node")], "PipeBurst severity 3", 3));
    }

    [Fact]
    public void Maps_IncidentResolved_To_V1()
    {
        var domain = new IncidentResolved("inc-1", new IncidentResolvedData("tenant-1", "operator-1", "fixed"));

        var ie = _mapper.Map(domain)!;
        ie.EventType.Should().Be(IncidentEventTypes.Resolved);
        ie.Should().BeOfType<IncidentResolvedIntegrationEvent>()
            .Which.Data.Should().BeEquivalentTo(new IncidentResolvedV1("inc-1", "tenant-1", "operator-1", "fixed"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter IncidentIntegrationEventMapperTests`
Expected: FAIL — new integration-event records / registry entries do not exist (compile error).

- [ ] **Step 3: Add three IE records** to `IncidentIntegrationEventMapper.cs` (after `IncidentIsolationPlanCreatedIntegrationEvent`):

```csharp
public sealed record IncidentIsolationPlanConfirmedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentIsolationPlanConfirmedV1 Data)
    : IIntegrationEvent<IncidentIsolationPlanConfirmedV1>;

public sealed record WorkOrderRequestedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, WorkOrderRequestedV1 Data)
    : IIntegrationEvent<WorkOrderRequestedV1>;

public sealed record IncidentResolvedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentResolvedV1 Data)
    : IIntegrationEvent<IncidentResolvedV1>;
```

- [ ] **Step 4: Add registry entries** inside the `Registry` initializer (after the `IncidentIsolationPlanCreated` line):

```csharp
            ["IncidentIsolationPlanConfirmed"] = e => e is IncidentIsolationPlanConfirmed x ? MapIsolationPlanConfirmed(x) : null,
            ["WorkOrderRequested"] = e => e is WorkOrderRequested x ? MapWorkOrderRequested(x) : null,
            ["IncidentResolved"] = e => e is IncidentResolved x ? MapResolved(x) : null,
```

- [ ] **Step 5: Add the three `Map*` methods** at the end of the class:

```csharp
    private static IncidentIsolationPlanConfirmedIntegrationEvent MapIsolationPlanConfirmed(IncidentIsolationPlanConfirmed e)
        => new(e.EventId, IncidentEventTypes.IsolationPlanConfirmed, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentIsolationPlanConfirmedV1(e.AggregateId, e.Data.TenantId, e.Data.PlanId, e.Data.GraphVersion,
                e.Data.ValvesToClose, e.Data.IsolatedNodes, e.Data.IsolatedPipes,
                e.Data.AffectedRefs.Select(r => new IncidentAssetRefV1(r.AssetId, r.Kind)).ToList(),
                e.Data.ConfirmedBy));

    private static WorkOrderRequestedIntegrationEvent MapWorkOrderRequested(WorkOrderRequested e)
        => new(e.EventId, IncidentEventTypes.WorkOrderRequested, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new WorkOrderRequestedV1(e.AggregateId,
                e.Data.AssetRefs.Select(r => new IncidentAssetRefV1(r.AssetId, r.Kind)).ToList(),
                e.Data.Summary, e.Data.Severity));

    private static IncidentResolvedIntegrationEvent MapResolved(IncidentResolved e)
        => new(e.EventId, IncidentEventTypes.Resolved, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentResolvedV1(e.AggregateId, e.Data.TenantId, e.Data.ResolvedBy, e.Data.ResolutionNote));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter IncidentIntegrationEventMapperTests`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/IncidentIntegrationEventMapperTests.cs
git commit -m "feat(inc3): map confirmed/work-order/resolved domain events to v1 integration events"
```

---

### Task 7: Application commands + handlers + command validators

**Files:**
- Create: `src/WaterNetwork.Incident.Application/Commands/ConfirmIsolationPlanCommand.cs`
- Create: `src/WaterNetwork.Incident.Application/Commands/ConfirmIsolationPlanCommandHandler.cs`
- Create: `src/WaterNetwork.Incident.Application/Commands/StartIncidentHandlingCommand.cs`
- Create: `src/WaterNetwork.Incident.Application/Commands/StartIncidentHandlingCommandHandler.cs`
- Create: `src/WaterNetwork.Incident.Application/Commands/ResolveIncidentCommand.cs`
- Create: `src/WaterNetwork.Incident.Application/Commands/ResolveIncidentCommandHandler.cs`
- Create: `src/WaterNetwork.Incident.Application/Validators/ConfirmIsolationPlanCommandValidator.cs`
- Create: `src/WaterNetwork.Incident.Application/Validators/StartIncidentHandlingCommandValidator.cs`
- Create: `src/WaterNetwork.Incident.Application/Validators/ResolveIncidentCommandValidator.cs`
- Test: `tests/WaterNetwork.Incident.UnitTests/Inc3CommandHandlerTests.cs` (create)

**Interfaces:**
- Consumes: aggregate methods (Tasks 2-4); `INetworkIncidentRepository`, `ITenantContextAccessor`, `IRequestContextProvider` (existing).
- Produces:
  - `ConfirmIsolationPlanCommand(string IncidentId, string? Note) : ICommand`
  - `StartIncidentHandlingCommand(string IncidentId, string? Note) : ICommand`
  - `ResolveIncidentCommand(string IncidentId, string? ResolutionNote) : ICommand`
  - Matching `ICommandHandler<TCommand, Unit>` handlers.
- Note: handlers register automatically via `AddHandlersFromAssembly(typeof(ReportIncidentCommand).Assembly)`; validators via `AddValidatorsFromAssembly(...)` — both already wired in `Program.cs`. No DI change.

- [ ] **Step 1: Write the failing test** — create `Inc3CommandHandlerTests.cs`. Reuse existing test doubles; mirror `RequestIsolationAnalysisHandlerTests`. First, open `tests/WaterNetwork.Incident.UnitTests/RequestIsolationAnalysisHandlerTests.cs` to copy its fake `INetworkIncidentRepository` / tenant / request-context setup, then:

```csharp
using FluentAssertions;
using WaterNetwork.Incident.Application.Commands;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Incident.UnitTests;

public sealed class Inc3CommandHandlerTests
{
    // Build an incident already at IsolationPlanReady, persisted in the fake repo.
    // (Use the same in-memory fake repo + tenant accessor ("tenant-1") + request context ("operator-1")
    //  that RequestIsolationAnalysisHandlerTests sets up.)

    [Fact]
    public async Task Confirm_Then_Start_Then_Resolve_Walks_To_Resolved()
    {
        // arrange: seed PlanReady incident for tenant-1 in fake repo (helper)
        // act + assert each handler moves status and saves
        // ConfirmIsolationPlanCommandHandler -> IsolationConfirmed
        // StartIncidentHandlingCommandHandler -> InProgress
        // ResolveIncidentCommandHandler -> Resolved
    }

    [Fact]
    public async Task Confirm_CrossTenant_Throws_NotFound()
    {
        // arrange: incident owned by tenant-1, tenant accessor returns tenant-2
        // act: ConfirmIsolationPlanCommandHandler.HandleAsync(...)
        // assert: throws NotFoundException
    }
}
```

> Implementer: flesh out the two tests using the concrete fakes from `RequestIsolationAnalysisHandlerTests.cs` (same project). The cross-tenant test asserts `await act.Should().ThrowAsync<NotFoundException>()`; the walk test asserts `incident.Status` after each handler via the fake repo's stored aggregate.

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter Inc3CommandHandlerTests`
Expected: FAIL — command/handler types do not exist (compile error).

- [ ] **Step 3: Create the three commands.**

`ConfirmIsolationPlanCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record ConfirmIsolationPlanCommand(string IncidentId, string? Note) : ICommand;
```

`StartIncidentHandlingCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record StartIncidentHandlingCommand(string IncidentId, string? Note) : ICommand;
```

`ResolveIncidentCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record ResolveIncidentCommand(string IncidentId, string? ResolutionNote) : ICommand;
```

- [ ] **Step 4: Create the three handlers** (each mirrors `ClassifyIncidentCommandHandler` — same tenant-scoped load + 404 + actor resolution).

`ConfirmIsolationPlanCommandHandler.cs`:

```csharp
using WaterNetwork.Incident.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Commands;

public sealed class ConfirmIsolationPlanCommandHandler(
    INetworkIncidentRepository repository,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<ConfirmIsolationPlanCommand, Unit>
{
    public async Task<Unit> HandleAsync(ConfirmIsolationPlanCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var incident = await repository.GetByIdAsync(command.IncidentId, ct);
        if (incident is null || incident.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("NetworkIncident", command.IncidentId);

        var actorId = requestContextProvider.Current()?.UserId ?? "unknown";
        incident.ConfirmIsolationPlan(actorId, command.Note);
        await repository.SaveAsync(incident, ct);
        return Unit.Value;
    }
}
```

`StartIncidentHandlingCommandHandler.cs` — identical shape; replace the command type with `StartIncidentHandlingCommand`, call `incident.StartIncidentHandling(actorId, command.Note)`.

`ResolveIncidentCommandHandler.cs` — identical shape; replace the command type with `ResolveIncidentCommand`, call `incident.ResolveIncident(actorId, command.ResolutionNote)`.

> Implementer: copy the `ConfirmIsolationPlanCommandHandler` body verbatim for the other two, changing only the class name, the `ICommandHandler<...>` command type, the parameter type, and the single aggregate method call shown above. (Repeated in full rather than referenced because tasks may be read out of order — but the only diffs are those four spots.)

- [ ] **Step 5: Create the three command validators.**

`ConfirmIsolationPlanCommandValidator.cs`:

```csharp
using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class ConfirmIsolationPlanCommandValidator : AbstractValidator<ConfirmIsolationPlanCommand>
{
    public ConfirmIsolationPlanCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.Note).MaximumLength(1000);
    }
}
```

`StartIncidentHandlingCommandValidator.cs` — same, for `StartIncidentHandlingCommand` (`Note` rule).

`ResolveIncidentCommandValidator.cs` — same, for `ResolveIncidentCommand` but the optional-text rule is `RuleFor(x => x.ResolutionNote).MaximumLength(1000);`.

- [ ] **Step 6: Run test to verify it passes**

Run: `dotnet test tests/WaterNetwork.Incident.UnitTests --filter Inc3CommandHandlerTests`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Application \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/Inc3CommandHandlerTests.cs
git commit -m "feat(inc3): application commands/handlers/validators for confirm/start/resolve"
```

---

### Task 8: API requests + validators + endpoints (integration tests)

**Files:**
- Create: `src/WaterNetwork.Incident.Api/Requests/ConfirmIsolationPlanRequest.cs`
- Create: `src/WaterNetwork.Incident.Api/Requests/StartIncidentHandlingRequest.cs`
- Create: `src/WaterNetwork.Incident.Api/Requests/ResolveIncidentRequest.cs`
- Create: `src/WaterNetwork.Incident.Api/Validators/ConfirmIsolationPlanRequestValidator.cs`
- Create: `src/WaterNetwork.Incident.Api/Validators/StartIncidentHandlingRequestValidator.cs`
- Create: `src/WaterNetwork.Incident.Api/Validators/ResolveIncidentRequestValidator.cs`
- Modify: `src/WaterNetwork.Incident.Api/Endpoints/IncidentsEndpointModule.cs`
- Test: `tests/WaterNetwork.Incident.IntegrationTests/IncidentLifecycleApiTests.cs` (create)

**Interfaces:**
- Consumes: the three commands (Task 7).
- Produces three endpoints:
  - `POST /api/incidents/{id}/isolation-plan/confirm` → `RequirePermission("network-incident:confirm")` → 204.
  - `POST /api/incidents/{id}/start-handling` → `RequirePermission("network-incident:write")` → 204.
  - `POST /api/incidents/{id}/resolve` → `RequirePermission("network-incident:write")` → 204.

- [ ] **Step 1: Write the failing test** — create `IncidentLifecycleApiTests.cs`. Copy the `StubFactory`, `Client`, and `ReportAndClassify` helpers from `IncidentIsolationApiTests.cs`, but `Client` must also grant `network-incident:confirm`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

[Collection("incident-postgis")]
public sealed class IncidentLifecycleApiTests(PostgisFixture postgis)
{
    private static IncidentApiFactory StubFactory(PostgisFixture pg)
    {
        var f = new IncidentApiFactory(pg);
        f.ConfigOverrides["Topology:Provider"] = "Stub";
        return f;
    }

    private static HttpClient Client(IncidentApiFactory factory, string tenantId = "tenant-1")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "operator-1", tenantId: tenantId,
            permissions: ["network-incident:write", "network-incident:read", "network-incident:confirm"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> ReportClassifyAnalyse(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/incidents", new
        {
            category = "PipeBurst", severity = 3,
            affectedRefs = new[] { new { assetId = "node-1", kind = "Node" } }
        });
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        await client.PostAsJsonAsync($"/api/incidents/{id}/classify", new { category = "PipeBurst", severity = 3, note = (string?)null });
        await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "node-1" });
        return id;
    }

    [Fact]
    public async Task Confirm_Start_Resolve_Walks_Incident_To_Resolved()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        var id = await ReportClassifyAnalyse(client);

        (await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-plan/confirm", new { note = (string?)null }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await client.PostAsJsonAsync($"/api/incidents/{id}/start-handling", new { note = (string?)null }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await client.PostAsJsonAsync($"/api/incidents/{id}/resolve", new { resolutionNote = "fixed" }))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("Resolved");
        detail["isolationPlans"]!.AsArray()[0]!["status"]!.GetValue<string>().Should().Be("Confirmed");
    }

    [Fact]
    public async Task Confirm_On_PlanReady_Missing_Returns_422()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        // report + classify only -> status Classified, no plan
        var resp0 = await client.PostAsJsonAsync("/api/incidents", new { category = "Leak", severity = 2 });
        var id = (await resp0.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        await client.PostAsJsonAsync($"/api/incidents/{id}/classify", new { category = "Leak", severity = 2, note = (string?)null });

        (await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-plan/confirm", new { note = (string?)null }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Confirm_CrossTenant_Returns_404()
    {
        using var factory = StubFactory(postgis);
        using var owner = Client(factory, "tenant-1");
        using var attacker = Client(factory, "tenant-2");
        var id = await ReportClassifyAnalyse(owner);

        (await attacker.PostAsJsonAsync($"/api/incidents/{id}/isolation-plan/confirm", new { note = (string?)null }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/WaterNetwork.Incident.IntegrationTests --filter IncidentLifecycleApiTests`
Expected: FAIL — endpoints/requests do not exist (404 on the new routes / compile error in request types).

- [ ] **Step 3: Create the three request records.**

`ConfirmIsolationPlanRequest.cs`:

```csharp
namespace WaterNetwork.Incident.Api.Requests;

public sealed record ConfirmIsolationPlanRequest(string? Note);
```

`StartIncidentHandlingRequest.cs`:

```csharp
namespace WaterNetwork.Incident.Api.Requests;

public sealed record StartIncidentHandlingRequest(string? Note);
```

`ResolveIncidentRequest.cs`:

```csharp
namespace WaterNetwork.Incident.Api.Requests;

public sealed record ResolveIncidentRequest(string? ResolutionNote);
```

- [ ] **Step 4: Create the three request validators.**

`ConfirmIsolationPlanRequestValidator.cs`:

```csharp
using FluentValidation;
using WaterNetwork.Incident.Api.Requests;

namespace WaterNetwork.Incident.Api.Validators;

public sealed class ConfirmIsolationPlanRequestValidator : AbstractValidator<ConfirmIsolationPlanRequest>
{
    public ConfirmIsolationPlanRequestValidator()
    {
        RuleFor(x => x.Note).MaximumLength(1000);
    }
}
```

`StartIncidentHandlingRequestValidator.cs` — same for `StartIncidentHandlingRequest` (`Note` rule).

`ResolveIncidentRequestValidator.cs` — same for `ResolveIncidentRequest` but `RuleFor(x => x.ResolutionNote).MaximumLength(1000);`.

- [ ] **Step 5: Add the three endpoints** to `IncidentsEndpointModule.cs` (after the `isolation-analysis` endpoint, before the closing braces). Add `using WaterNetwork.Incident.Application.Commands;` is already present.

```csharp
        group.MapPost("/{id}/isolation-plan/confirm", async (
                string id, ConfirmIsolationPlanRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ConfirmIsolationPlanCommand(id, request.Note), ct);
                return Results.NoContent();
            })
            .WithValidation<ConfirmIsolationPlanRequest>()
            .RequirePermission("network-incident:confirm");

        group.MapPost("/{id}/start-handling", async (
                string id, StartIncidentHandlingRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new StartIncidentHandlingCommand(id, request.Note), ct);
                return Results.NoContent();
            })
            .WithValidation<StartIncidentHandlingRequest>()
            .RequirePermission("network-incident:write");

        group.MapPost("/{id}/resolve", async (
                string id, ResolveIncidentRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ResolveIncidentCommand(id, request.ResolutionNote), ct);
                return Results.NoContent();
            })
            .WithValidation<ResolveIncidentRequest>()
            .RequirePermission("network-incident:write");
```

- [ ] **Step 6: Run test to verify it passes**

Run: `dotnet test tests/WaterNetwork.Incident.IntegrationTests --filter IncidentLifecycleApiTests`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Api \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/IncidentLifecycleApiTests.cs
git commit -m "feat(inc3): confirm/start-handling/resolve endpoints + validators"
```

---

### Task 9: Docs — event catalog + decision record

**Files:**
- Modify: `docs/conventions/event-catalog.md`
- Create: `docs/decisions/0024-incident-confirm-handle-resolve.md`
- Modify: `docs/stories/backlog.md`
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`

- [ ] **Step 1: Add event-catalog rows** after the existing `incident.*` rows in `docs/conventions/event-catalog.md`:

```markdown
| `incident.isolation-plan-confirmed` | v1 | water-network-incident-be | (none yet; customer-impact CIM-1 [future]) | `IncidentIsolationPlanConfirmedV1` | shipped (INC-3) |
| `maintenance.work-order-requested` | v1 | water-network-incident-be | (none yet; maintenance-be MNT-1 [future]) | `WorkOrderRequestedV1` (FROZEN Phase 3→4 contract) | shipped (INC-3) |
| `incident.resolved` | v1 | water-network-incident-be | (none yet) | `IncidentResolvedV1` | shipped (INC-3) |
```

> Also update the `incident.isolation-plan-created` row's consumer column if needed; leave other rows untouched.

- [ ] **Step 2: Write decision `0024-incident-confirm-handle-resolve.md`** following the format of `0023-incident-isolation-analysis.md`. Content: the linear isolation-first lifecycle (`IsolationPlanReady → IsolationConfirmed → InProgress → Resolved`), the three new statuses + `IsolationPlanStatus.Confirmed`, all three transitions emit one event (decision-0023 invariant), and the **frozen `maintenance.work-order-requested` v1 contract** as the Phase 3→4 boundary. Record the deferred items: non-isolation handling path, event consumers, re-open. Reference the spec.

- [ ] **Step 3: Update `docs/stories/backlog.md`** — change the Phase 3 epic status row to mark INC-3 done, and add a "Follow-up sau INC-3" section listing deferrals (non-isolation path; no consumers yet for the three events; `network-incident:confirm` not enforced via real Keycloak — US-X; re-open not supported).

- [ ] **Step 4: Mark INC-3 done in the roadmap** — in `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §3.3 add a ✓ to the INC-3 row, and update §9.3 item 3 to a SHIPPED note (mirror the INC-2 SHIPPED note style).

- [ ] **Step 5: Run the full suite (verification gate)** — all projects, 0 warnings:

```bash
dotnet test tests/WaterNetwork.Incident.UnitTests
dotnet test tests/WaterNetwork.Incident.ContractTests
dotnet test tests/WaterNetwork.Incident.IntegrationTests
```
Expected: all PASS, 0 warnings. (Integration tests need Docker for the PostGIS Testcontainer.)

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs(inc3): event catalog, decision 0024, backlog + roadmap status"
```

---

## Self-Review

**Spec coverage:**
- §2 linear isolation-first lifecycle → Tasks 1-4 (enums + 3 transitions, isolation-first guards).
- §3.1 new enum members → Task 1. §3.2 commands + guards (incl. `NoProposedPlan`, `AsConfirmed`) → Tasks 1-4.
- §4.1 `incident.isolation-plan-confirmed` → Tasks 2 (domain), 5 (contract), 6 (mapper). §4.2 frozen `maintenance.work-order-requested` → Tasks 3, 5, 6 (+ contract test asserts exactly 4 fields & ref = {AssetId,Kind}). §4.3 `incident.resolved` → Tasks 4, 5, 6.
- §5 endpoints + permissions (confirm = `network-incident:confirm`; others = `:write`) → Task 8.
- §6 no migration; outbox auto-registration → noted in Global Constraints + Tasks 6/7 DI notes.
- §7 testing (unit guards, integration walk + 422 + cross-tenant 404, contract schemas) → Tasks 1-8. §8 decision 0024 → Task 9.

**Placeholder scan:** Task 7 Step 1 leaves test bodies as guided stubs (the fakes live in a sibling test file the implementer must copy); every production-code step shows complete code. Tasks 7 handlers and validators 2-3, and Task 8 validators 2-3, say "same as above, change these N spots" with the spots enumerated and the reference code shown in full in the same task — acceptable (DRY within a task, diffs explicit).

**Type consistency:** Domain ref record `IncidentAssetRefData(AssetId, Kind)` (Task 2) is reused in Task 3 and mapped to contract `IncidentAssetRefV1(AssetId, Kind)` (Task 5) in Task 6. Event-type constants `IsolationPlanConfirmed/Resolved/WorkOrderRequested` defined in Task 5 are consumed by the mapper in Task 6. Commands `ConfirmIsolationPlanCommand/StartIncidentHandlingCommand/ResolveIncidentCommand` (Task 7) consumed by endpoints (Task 8). Aggregate method names `ConfirmIsolationPlan/StartIncidentHandling/ResolveIncident` consistent across Tasks 2-4, 7. `eventType` strings (`"IncidentIsolationPlanConfirmed"`, `"WorkOrderRequested"`, `"IncidentResolved"`) match between domain events (Tasks 2-4) and mapper registry keys (Task 6).
