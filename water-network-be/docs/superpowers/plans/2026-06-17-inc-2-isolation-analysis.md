# INC-2 Isolation Analysis via gRPC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `RequestIsolationAnalysis` to `water-network-incident-be` — a synchronous gRPC call to topology-rs `ComputeIsolationZone` that snapshots an `IsolationPlan` on the incident, emits `incident.isolation-plan-created` v1, and is the platform's first .NET→Rust gRPC integration (closing the contract-test deferral from decision 0019).

**Architecture:** A new Application port `ITopologyAnalysisPort` is implemented by a `GrpcTopologyAnalysisAdapter` (real, generated from the committed `proto/topology.proto`) and a `StubTopologyAnalysisAdapter` (config-swapped via `Topology:Provider`, used by API integration tests — mirrors the existing `GisLookup:Provider` pattern). The command handler runs the gRPC call inline: success records a `Proposed` plan and transitions the incident `Classified → IsolationRequested → IsolationPlanReady`; a transport failure records an `AnalysisFailed` plan and leaves the incident in `IsolationRequested` (user-retryable, no exception surfaced to the client). The isolation result is an immutable snapshot — re-analysis supersedes the prior plan. `start_node_id` is supplied explicitly by the caller (pipe/device→node resolution stays deferred per decisions 0019/0020).

**Tech Stack:** .NET 10, Grpc.Net.Client + Grpc.Net.ClientFactory + Google.Protobuf + Grpc.Tools (proto → C# client), EF Core + Npgsql (`text[]` array columns), Testcontainers (real Rust topology image for the wire-compat contract test), xUnit + FluentAssertions + NSubstitute.

---

## Reference patterns (already in the repo — read before coding)

- **State machine + domain events:** `src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/Aggregates/NetworkIncident.cs` (`Classify`/`Cancel` shape), `.../DomainEvents/IncidentClassified.cs`.
- **Port + config-swapped adapter:** `.../Application/Ports/IGisLookupPort.cs`, `.../Infrastructure/GisLookup/StubGisLookupAdapter.cs` + `GisLookupOptions.cs`, and the `Topology:Provider` analogue we add here.
- **Command handler with tenant guard:** `.../Application/Commands/ClassifyIncidentCommandHandler.cs`.
- **Integration event mapper registry:** `.../Infrastructure/IntegrationEvents/IncidentIntegrationEventMapper.cs`.
- **Persistence:** `.../Infrastructure/Repositories/NetworkIncidentRepository.cs`, `.../Persistence/Configurations/IncidentTimelineEntryConfiguration.cs`, `.../Persistence/Models/IncidentTimelineEntryModel.cs`.
- **Read DAO:** `.../Infrastructure/Repositories/IncidentReadDao.cs`.
- **API endpoint + integration test:** `.../Api/Endpoints/IncidentsEndpointModule.cs`, `.../tests/.../IncidentApiTests.cs`, `.../IncidentApiFactory.cs`.
- **Topology gRPC contract:** `src/services/water-network-topology-rs/proto/topology.proto` (the `ComputeIsolationZone` RPC). Topology gRPC server binds in a spawned task **before** the AMQP consumer loop, so the gRPC port is reachable even with no RabbitMQ (`crates/topology-service/src/main.rs`). Decisions 0019, 0020.

**Design decisions locked for this slice (captured in Task 1's ADR 0023):**
1. `IncidentStatus` gains `IsolationRequested`, `IsolationPlanReady` only. `PlanConfirmed`/`HandlingStarted`/`Resolved` stay for INC-3 (decision 0021 rule: "no state without a transition that reaches it").
2. `IsolationPlanStatus` = `Proposed`, `AnalysisFailed`, `Superseded`. `Confirmed` deferred to INC-3.
3. `start_node_id` supplied explicitly; resolution of pipe/device assetRef → node deferred (decisions 0019 §3, 0020 §2).
4. Analysis is synchronous in the handler. Transport failure is **persisted** as an `AnalysisFailed` plan and returned as a normal `200` result (retryable) — not thrown — so the failed attempt is auditable.
5. Adapter swapped via `Topology:Provider` (`Grpc` default, `Stub` for API integration tests).
6. gRPC contract test = real Rust image via Testcontainers, empty-graph wire-compat assertion.

---

## Task 1: ADR 0023 + extend domain enums

**Files:**
- Create: `docs/decisions/0023-incident-isolation-analysis.md`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/ValueObjects/IncidentStatus.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/ValueObjects/IsolationPlanStatus.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/ValueObjects/TimelineEntryType.cs`

- [ ] **Step 1: Write ADR 0023**

Create `docs/decisions/0023-incident-isolation-analysis.md`:

```markdown
# 0023 Incident Isolation Analysis (INC-2) — gRPC topology port, synchronous plan snapshot

Date: 2026-06-17

## Status

Accepted

## Context

INC-2 (US-P3-04) adds isolation analysis to `water-network-incident-be`. It is the
first .NET service to call topology-rs over gRPC (`ComputeIsolationZone`, decisions
0019/0020) and the place where the .NET client contract test deferred in decision
0019 is implemented. Several choices must be settled.

## Decision

1. **State machine extension is the INC-2 subset only.** `IncidentStatus` gains
   `IsolationRequested` and `IsolationPlanReady`. `PlanConfirmed`, `HandlingStarted`,
   and `Resolved` remain for INC-3 (decision 0021: no state without a reaching
   transition). Transitions added: `{Classified, IsolationPlanReady, IsolationRequested}
   → IsolationRequested` (re-analysis allowed), `IsolationRequested → IsolationPlanReady`.

2. **IsolationPlan is an immutable snapshot.** Each analysis attempt creates an
   `IsolationPlan` child entity. Re-analysis marks the prior `Proposed` plan
   `Superseded` and appends a new one; plans are never edited in place.
   `IsolationPlanStatus` = `Proposed`, `AnalysisFailed`, `Superseded`. `Confirmed`
   is deferred to INC-3.

3. **Analysis is synchronous; failure is persisted, not thrown.** The command handler
   calls the gRPC port inline (5s deadline, 3 retries). On success it records a
   `Proposed` plan and transitions to `IsolationPlanReady`. On transport failure it
   records an `AnalysisFailed` plan, leaves the incident in `IsolationRequested`
   (user-retryable), and returns a normal result — the failed attempt is auditable on
   the timeline. No integration event is emitted for a failed attempt.

4. **`start_node_id` is supplied by the caller.** Consistent with decisions 0019 §3
   and 0020 §2, the RPC is node-based. Resolving a pipe or device assetRef to its
   incident node(s) is deferred to a later TOP-x/INC-x slice.

5. **Adapter is config-swapped via `Topology:Provider`** (`Grpc` default, `Stub` for
   tests) — mirrors `GisLookup:Provider` (decision 0021).

6. **Event `incident.isolation-plan-created` v1** carries the full plan snapshot
   (`tenantId` explicit, like other incident events) for INC-3/customer-impact consumers.

7. **gRPC contract test = real topology image (Testcontainers), empty-graph
   wire-compat.** The .NET client generated from `proto/topology.proto` is exercised
   against the actual Rust binary; an unknown-tenant call returns an empty, well-formed
   response (decision 0020 §5), proving cross-language wire compatibility. This closes
   the decision 0019 follow-up.

## Consequences

- incident-be takes a build-time dependency on `proto/topology.proto` (owned by
  topology-rs) via `Grpc.Tools`. A breaking proto change requires a new package
  version and a coordinated update.
- The isolation result is exact for the modelled valve placement (decision 0020).
  Valve open/closed state is not considered (Phase 5).
- INC-3 extends `IncidentStatus`/`IsolationPlanStatus` with confirm/handle/resolve
  and adds `maintenance.work-order-requested`.
```

- [ ] **Step 2: Extend `IncidentStatus`**

Replace the body of `IncidentStatus.cs`:

```csharp
namespace WaterNetwork.Incident.Domain.ValueObjects;

// INC-1 subset + INC-2 isolation states (decisions 0021, 0023). INC-3 extends further.
public enum IncidentStatus
{
    Reported,
    Classified,
    Cancelled,
    IsolationRequested,
    IsolationPlanReady
}
```

- [ ] **Step 3: Create `IsolationPlanStatus`**

Create `IsolationPlanStatus.cs`:

```csharp
namespace WaterNetwork.Incident.Domain.ValueObjects;

// INC-2 subset (decision 0023). INC-3 adds Confirmed.
public enum IsolationPlanStatus
{
    Proposed,
    AnalysisFailed,
    Superseded
}
```

- [ ] **Step 4: Extend `TimelineEntryType`**

Read `TimelineEntryType.cs` and add three members alongside the existing `Reported`/`Classified`/`Cancelled` (keep existing members unchanged):

```csharp
namespace WaterNetwork.Incident.Domain.ValueObjects;

public enum TimelineEntryType
{
    Reported,
    Classified,
    Cancelled,
    IsolationRequested,
    IsolationPlanReady,
    AnalysisFailed
}
```

- [ ] **Step 5: Build the Domain project**

Run: `dotnet build src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/WaterNetwork.Incident.Domain.csproj`
Expected: Build succeeded, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0023-incident-isolation-analysis.md \
        src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/ValueObjects/
git commit -m "docs(incident): INC-2 ADR 0023 + extend status/plan/timeline enums (INC-2)"
```

---

## Task 2: `IsolationPlan` child entity (Domain, TDD)

**Files:**
- Test: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/IsolationPlanTests.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/Entities/IsolationPlan.cs`

- [ ] **Step 1: Write the failing test**

Create `IsolationPlanTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Incident.Domain.Entities;
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.UnitTests;

public sealed class IsolationPlanTests
{
    [Fact]
    public void Proposed_Captures_Snapshot()
    {
        var plan = IsolationPlan.Proposed(
            incidentId: "inc-1", startNodeId: "node-1", graphVersion: 7,
            valvesToClose: ["v2", "v1"], isolatedNodes: ["n1"], isolatedPipes: ["p1"], sequence: 0);

        plan.Status.Should().Be(IsolationPlanStatus.Proposed);
        plan.StartNodeId.Should().Be("node-1");
        plan.GraphVersion.Should().Be(7);
        plan.ValvesToClose.Should().Equal("v2", "v1");
        plan.IsolatedNodes.Should().Equal("n1");
        plan.IsolatedPipes.Should().Equal("p1");
        plan.FailureReason.Should().BeNull();
        plan.Sequence.Should().Be(0);
        plan.Id.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public void Failed_Has_Reason_And_Empty_Lists()
    {
        var plan = IsolationPlan.Failed("inc-1", "node-1", "topology unreachable", sequence: 1);

        plan.Status.Should().Be(IsolationPlanStatus.AnalysisFailed);
        plan.FailureReason.Should().Be("topology unreachable");
        plan.ValvesToClose.Should().BeEmpty();
        plan.IsolatedNodes.Should().BeEmpty();
        plan.IsolatedPipes.Should().BeEmpty();
        plan.GraphVersion.Should().Be(0);
        plan.Sequence.Should().Be(1);
    }

    [Fact]
    public void Supersede_Only_Allowed_From_Proposed()
    {
        var proposed = IsolationPlan.Proposed("inc-1", "node-1", 1, [], [], [], 0);
        var superseded = proposed.AsSuperseded();
        superseded.Status.Should().Be(IsolationPlanStatus.Superseded);

        var failed = IsolationPlan.Failed("inc-1", "node-1", "x", 0);
        failed.Invoking(p => p.AsSuperseded()).Should().Throw<InvalidOperationException>();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj --filter FullyQualifiedName~IsolationPlanTests`
Expected: FAIL — `IsolationPlan` does not exist.

- [ ] **Step 3: Implement `IsolationPlan`**

Create `IsolationPlan.cs`:

```csharp
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Domain.Entities;

/// <summary>Immutable snapshot of a topology isolation computation for an incident
/// (decision 0023). Re-analysis supersedes the prior Proposed plan; plans are never
/// edited in place.</summary>
public sealed record IsolationPlan
{
    public string Id { get; init; }
    public IsolationPlanStatus Status { get; init; }
    public string StartNodeId { get; init; }
    public long GraphVersion { get; init; }
    public IReadOnlyList<string> ValvesToClose { get; init; }
    public IReadOnlyList<string> IsolatedNodes { get; init; }
    public IReadOnlyList<string> IsolatedPipes { get; init; }
    public string? FailureReason { get; init; }
    public DateTime ComputedAt { get; init; }
    public int Sequence { get; init; }

    private IsolationPlan(
        string id, IsolationPlanStatus status, string startNodeId, long graphVersion,
        IReadOnlyList<string> valvesToClose, IReadOnlyList<string> isolatedNodes,
        IReadOnlyList<string> isolatedPipes, string? failureReason, DateTime computedAt, int sequence)
    {
        Id = id;
        Status = status;
        StartNodeId = startNodeId;
        GraphVersion = graphVersion;
        ValvesToClose = valvesToClose;
        IsolatedNodes = isolatedNodes;
        IsolatedPipes = isolatedPipes;
        FailureReason = failureReason;
        ComputedAt = computedAt;
        Sequence = sequence;
    }

    public static IsolationPlan Proposed(
        string incidentId, string startNodeId, long graphVersion,
        IReadOnlyList<string> valvesToClose, IReadOnlyList<string> isolatedNodes,
        IReadOnlyList<string> isolatedPipes, int sequence)
        => new(Guid.CreateVersion7().ToString(), IsolationPlanStatus.Proposed, startNodeId, graphVersion,
            valvesToClose, isolatedNodes, isolatedPipes, failureReason: null, DateTime.UtcNow, sequence);

    public static IsolationPlan Failed(string incidentId, string startNodeId, string reason, int sequence)
        => new(Guid.CreateVersion7().ToString(), IsolationPlanStatus.AnalysisFailed, startNodeId, graphVersion: 0,
            [], [], [], reason, DateTime.UtcNow, sequence);

    public IsolationPlan AsSuperseded()
    {
        if (Status != IsolationPlanStatus.Proposed)
            throw new InvalidOperationException($"Only a Proposed plan can be superseded; current status is {Status}.");
        return this with { Status = IsolationPlanStatus.Superseded };
    }

    /// <summary>Rehydrate from persistence (no validation; trusted store).</summary>
    public static IsolationPlan Reconstitute(
        string id, IsolationPlanStatus status, string startNodeId, long graphVersion,
        IReadOnlyList<string> valvesToClose, IReadOnlyList<string> isolatedNodes,
        IReadOnlyList<string> isolatedPipes, string? failureReason, DateTime computedAt, int sequence)
        => new(id, status, startNodeId, graphVersion, valvesToClose, isolatedNodes, isolatedPipes,
            failureReason, computedAt, sequence);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj --filter FullyQualifiedName~IsolationPlanTests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/Entities/IsolationPlan.cs \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/IsolationPlanTests.cs
git commit -m "feat(incident): INC-2 IsolationPlan snapshot entity (INC-2)"
```

---

## Task 3: `NetworkIncident` isolation transitions + domain event (Domain, TDD)

**Files:**
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/DomainEvents/IncidentIsolationPlanCreated.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/Aggregates/NetworkIncident.cs`
- Test: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/NetworkIncidentIsolationTests.cs`

- [ ] **Step 1: Create the domain event**

Create `IncidentIsolationPlanCreated.cs` (mirror `IncidentClassified.cs`):

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentIsolationPlanCreatedData(
    string TenantId,
    string PlanId,
    string StartNodeId,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    string ComputedBy);

public sealed record IncidentIsolationPlanCreated(string AggregateId, IncidentIsolationPlanCreatedData Data)
    : DomainEventBase<IncidentIsolationPlanCreatedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentIsolationPlanCreated",
        data: Data);
```

- [ ] **Step 2: Write the failing test**

Create `NetworkIncidentIsolationTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.DomainEvents;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Incident.UnitTests;

public sealed class NetworkIncidentIsolationTests
{
    private static NetworkIncident Classified()
    {
        var i = NetworkIncident.Report("tenant-1", IncidentCategory.PipeBurst, 3, 106.7, 10.8,
            [AssetRef.Create("node-1", AssetRefKind.Node, true)], "operator-1");
        i.Classify(IncidentCategory.PipeBurst, 3, "operator-1", note: null);
        return i;
    }

    [Fact]
    public void RequestIsolationAnalysis_From_Classified_Moves_To_IsolationRequested()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");

        i.Status.Should().Be(IncidentStatus.IsolationRequested);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.IsolationRequested);
    }

    [Fact]
    public void RequestIsolationAnalysis_From_Reported_Throws()
    {
        var i = NetworkIncident.Report("tenant-1", IncidentCategory.Leak, 2, null, null,
            [], "op");
        i.Invoking(x => x.RequestIsolationAnalysis("node-1", "op"))
            .Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void RecordIsolationPlan_Adds_Proposed_Plan_Event_And_Moves_To_Ready()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.ClearDomainEvents();

        i.RecordIsolationPlan(
            graphVersion: 5, valvesToClose: ["v1"], isolatedNodes: ["node-1"], isolatedPipes: ["p1"],
            actorId: "operator-1");

        i.Status.Should().Be(IncidentStatus.IsolationPlanReady);
        i.IsolationPlans.Should().ContainSingle(p => p.Status == IsolationPlanStatus.Proposed);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.IsolationPlanReady);
        i.GetDomainEvents().Should().ContainSingle(e => e is IncidentIsolationPlanCreated);
    }

    [Fact]
    public void RecordAnalysisFailure_Keeps_IsolationRequested_And_Adds_Failed_Plan_No_Event()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.ClearDomainEvents();

        i.RecordAnalysisFailure("topology unreachable", "operator-1");

        i.Status.Should().Be(IncidentStatus.IsolationRequested);
        i.IsolationPlans.Should().ContainSingle(p => p.Status == IsolationPlanStatus.AnalysisFailed);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.AnalysisFailed);
        i.GetDomainEvents().Should().BeEmpty();
    }

    [Fact]
    public void Reanalysis_Supersedes_Prior_Proposed_Plan()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.RecordIsolationPlan(1, ["v1"], ["node-1"], [], "operator-1");

        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.RecordIsolationPlan(2, ["v2"], ["node-1"], [], "operator-1");

        i.IsolationPlans.Count(p => p.Status == IsolationPlanStatus.Superseded).Should().Be(1);
        i.IsolationPlans.Count(p => p.Status == IsolationPlanStatus.Proposed).Should().Be(1);
        i.IsolationPlans.Single(p => p.Status == IsolationPlanStatus.Proposed).GraphVersion.Should().Be(2);
    }
}
```

> Note: `ClearDomainEvents` is the existing `AggregateRoot` helper used elsewhere in these tests; if the method is named differently in `WaterPlatform.BuildingBlocks.Domain.Entities.AggregateRoot`, use the existing name (check `GetDomainEvents`'s sibling). If no public clear exists, drop the two `ClearDomainEvents()` lines and assert with `.Should().Contain(...)` instead of `.ContainSingle(...)`.

- [ ] **Step 3: Run test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj --filter FullyQualifiedName~NetworkIncidentIsolationTests`
Expected: FAIL — methods `RequestIsolationAnalysis`/`RecordIsolationPlan`/`RecordAnalysisFailure`/`IsolationPlans` not defined.

- [ ] **Step 4: Implement the transitions on `NetworkIncident`**

In `NetworkIncident.cs`: add a backing list field next to the existing lists, a public read-only projection, and the three methods. Also add `using WaterNetwork.Incident.Domain.Entities;` if not present (it already imports Entities for `IncidentTimelineEntry`).

Add the field (next to `_affectedRefs`/`_timeline`):

```csharp
    private readonly List<IsolationPlan> _isolationPlans = [];
```

Add the projection (next to `AffectedRefs`/`TimelineEntries`):

```csharp
    public IReadOnlyList<IsolationPlan> IsolationPlans => _isolationPlans.AsReadOnly();
```

Add the methods (after `Cancel`):

```csharp
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
        MarkAsModified();
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
        MarkAsModified();
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
```

- [ ] **Step 5: Wire `_isolationPlans` into `Reconstitute`**

Modify the `Reconstitute` signature to accept plans, and populate the list. Change the method to:

```csharp
    public static NetworkIncident Reconstitute(
        string id, string tenantId, IncidentCategory category, int severity,
        double? longitude, double? latitude, IncidentStatus status, string reportedBy,
        string? cancellationReason, int version, DateTime createdAt, DateTime updatedAt,
        IEnumerable<AssetRef> affectedRefs, IEnumerable<IncidentTimelineEntry> timeline,
        IEnumerable<IsolationPlan> isolationPlans)
    {
        var incident = new NetworkIncident(id, tenantId, category, severity, longitude, latitude,
            status, reportedBy, cancellationReason, version, createdAt, updatedAt);
        incident._affectedRefs.AddRange(affectedRefs);
        incident._timeline.AddRange(timeline);
        incident._isolationPlans.AddRange(isolationPlans);
        return incident;
    }
```

> The repository (Task 7) is the only caller of `Reconstitute` and will be updated to pass plans. The Domain build will fail until Task 7, but the Domain unit tests in this task do not call `Reconstitute`, so they compile and run independently.

- [ ] **Step 6: Run test to verify it passes**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj --filter FullyQualifiedName~NetworkIncidentIsolationTests`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/ \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/NetworkIncidentIsolationTests.cs
git commit -m "feat(incident): INC-2 isolation transitions + IncidentIsolationPlanCreated event (INC-2)"
```

---

## Task 4: Application port, command, handler, validator (TDD)

**Files:**
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/Ports/ITopologyAnalysisPort.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/Commands/RequestIsolationAnalysisCommand.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/Commands/RequestIsolationAnalysisCommandHandler.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/Validators/RequestIsolationAnalysisCommandValidator.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/Dtos/IsolationAnalysisResultDto.cs`
- Test: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/RequestIsolationAnalysisHandlerTests.cs`

- [ ] **Step 1: Create the port + result + exception**

Create `ITopologyAnalysisPort.cs`:

```csharp
namespace WaterNetwork.Incident.Application.Ports;

/// <summary>Computes a network isolation zone for an incident's start node via topology-rs
/// (decisions 0019/0020/0023). The Grpc adapter wraps transport faults in
/// <see cref="TopologyAnalysisException"/>; a Stub adapter swaps in for tests via
/// <c>Topology:Provider</c>.</summary>
public interface ITopologyAnalysisPort
{
    Task<IsolationZoneResult> ComputeIsolationZoneAsync(string tenantId, string startNodeId, CancellationToken ct = default);
}

public sealed record IsolationZoneResult(
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    long GraphVersion);

/// <summary>Thrown by the topology port adapter when the analysis cannot be obtained
/// (transport error, deadline exceeded after retries). The handler records an
/// AnalysisFailed plan rather than propagating this to the client (decision 0023 §3).</summary>
public sealed class TopologyAnalysisException(string message, Exception? inner = null)
    : Exception(message, inner);
```

- [ ] **Step 2: Create the command + result DTO**

Create `RequestIsolationAnalysisCommand.cs`:

```csharp
using WaterNetwork.Incident.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record RequestIsolationAnalysisCommand(string IncidentId, string StartNodeId)
    : ICommand<IsolationAnalysisResultDto>;
```

Create `IsolationAnalysisResultDto.cs`:

```csharp
namespace WaterNetwork.Incident.Application.Dtos;

public sealed record IsolationAnalysisResultDto(
    string IncidentId,
    string PlanId,
    string Status,            // "Proposed" or "AnalysisFailed"
    string IncidentStatus,    // "IsolationPlanReady" or "IsolationRequested"
    string? FailureReason,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes);
```

> Verify the marker interface name: the existing `ReportIncidentCommand` returns a value, so check whether it uses `ICommand<T>` or another form in `WaterPlatform.BuildingBlocks.Application.Commands`. Match that exact interface. (`ClassifyIncidentCommand` returns `Unit`; `ReportIncidentCommand` returns the new id — use the same generic command interface `ReportIncidentCommand` uses.)

- [ ] **Step 3: Write the failing handler test**

Create `RequestIsolationAnalysisHandlerTests.cs`:

```csharp
using FluentAssertions;
using NSubstitute;
using WaterNetwork.Incident.Application.Commands;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.UnitTests;

public sealed class RequestIsolationAnalysisHandlerTests
{
    private readonly INetworkIncidentRepository _repo = Substitute.For<INetworkIncidentRepository>();
    private readonly ITopologyAnalysisPort _topology = Substitute.For<ITopologyAnalysisPort>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();
    private readonly IRequestContextProvider _request = Substitute.For<IRequestContextProvider>();

    public RequestIsolationAnalysisHandlerTests()
    {
        _tenant.Current.Returns(new TenantContext("tenant-1"));
        _request.Current().Returns(new RequestContext("operator-1", "tenant-1", null));
    }

    private RequestIsolationAnalysisCommandHandler Handler() =>
        new(_repo, _topology, _tenant, _request);

    private static NetworkIncident Classified(string tenant = "tenant-1")
    {
        var i = NetworkIncident.Report(tenant, IncidentCategory.PipeBurst, 3, 1, 1,
            [AssetRef.Create("node-1", AssetRefKind.Node, true)], "operator-1");
        i.Classify(IncidentCategory.PipeBurst, 3, "operator-1", null);
        return i;
    }

    [Fact]
    public async Task Success_Records_Plan_And_Returns_Ready()
    {
        var incident = Classified();
        _repo.GetByIdAsync(incident.Id, Arg.Any<CancellationToken>()).Returns(incident);
        _topology.ComputeIsolationZoneAsync("tenant-1", "node-1", Arg.Any<CancellationToken>())
            .Returns(new IsolationZoneResult(["v1"], ["node-1"], ["p1"], 9));

        var result = await Handler().HandleAsync(
            new RequestIsolationAnalysisCommand(incident.Id, "node-1"), CancellationToken.None);

        result.Status.Should().Be("Proposed");
        result.IncidentStatus.Should().Be("IsolationPlanReady");
        result.ValvesToClose.Should().Equal("v1");
        result.GraphVersion.Should().Be(9);
        await _repo.Received(1).SaveAsync(incident, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Topology_Failure_Records_AnalysisFailed_And_Returns_Retryable()
    {
        var incident = Classified();
        _repo.GetByIdAsync(incident.Id, Arg.Any<CancellationToken>()).Returns(incident);
        _topology.ComputeIsolationZoneAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns<IsolationZoneResult>(_ => throw new TopologyAnalysisException("unreachable"));

        var result = await Handler().HandleAsync(
            new RequestIsolationAnalysisCommand(incident.Id, "node-1"), CancellationToken.None);

        result.Status.Should().Be("AnalysisFailed");
        result.IncidentStatus.Should().Be("IsolationRequested");
        result.FailureReason.Should().Contain("unreachable");
        await _repo.Received(1).SaveAsync(incident, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Other_Tenants_Incident_Throws_NotFound()
    {
        var incident = Classified("other-tenant");
        _repo.GetByIdAsync(incident.Id, Arg.Any<CancellationToken>()).Returns(incident);

        await Handler().Invoking(h => h.HandleAsync(
                new RequestIsolationAnalysisCommand(incident.Id, "node-1"), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
    }

    [Fact]
    public async Task Wrong_State_Throws_BusinessRule()
    {
        var reported = NetworkIncident.Report("tenant-1", IncidentCategory.Leak, 2, null, null, [], "op");
        _repo.GetByIdAsync(reported.Id, Arg.Any<CancellationToken>()).Returns(reported);

        await Handler().Invoking(h => h.HandleAsync(
                new RequestIsolationAnalysisCommand(reported.Id, "node-1"), CancellationToken.None))
            .Should().ThrowAsync<BusinessRuleException>();
    }
}
```

> Verify the constructor shapes of `TenantContext` and `RequestContext` against the building blocks (the handler in `ClassifyIncidentCommandHandler` reads `tenant.TenantId` and `requestContextProvider.Current()?.UserId`). Adjust the test's `Returns(...)` constructions to whatever those types' real constructors/factories are. If `TenantContext`/`RequestContext` are not directly constructable, substitute them too (`Substitute.For<...>()` + property stubs).

- [ ] **Step 4: Run test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj --filter FullyQualifiedName~RequestIsolationAnalysisHandlerTests`
Expected: FAIL — handler does not exist.

- [ ] **Step 5: Implement the handler**

Create `RequestIsolationAnalysisCommandHandler.cs` (model the tenant guard on `ClassifyIncidentCommandHandler`):

```csharp
using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Commands;

public sealed class RequestIsolationAnalysisCommandHandler(
    INetworkIncidentRepository repository,
    ITopologyAnalysisPort topology,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider)
    : ICommandHandler<RequestIsolationAnalysisCommand, IsolationAnalysisResultDto>
{
    public async Task<IsolationAnalysisResultDto> HandleAsync(RequestIsolationAnalysisCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var incident = await repository.GetByIdAsync(command.IncidentId, ct);
        if (incident is null || incident.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("NetworkIncident", command.IncidentId);

        var actorId = requestContextProvider.Current()?.UserId ?? "unknown";
        incident.RequestIsolationAnalysis(command.StartNodeId, actorId);

        try
        {
            var zone = await topology.ComputeIsolationZoneAsync(tenant.TenantId, command.StartNodeId.Trim(), ct);
            incident.RecordIsolationPlan(zone.GraphVersion, zone.ValvesToClose, zone.IsolatedNodes, zone.IsolatedPipes, actorId);
        }
        catch (TopologyAnalysisException ex)
        {
            incident.RecordAnalysisFailure(ex.Message, actorId);
        }

        await repository.SaveAsync(incident, ct);

        var plan = incident.IsolationPlans[^1];
        return new IsolationAnalysisResultDto(
            incident.Id, plan.Id, plan.Status.ToString(), incident.Status.ToString(),
            plan.FailureReason, plan.GraphVersion, plan.ValvesToClose, plan.IsolatedNodes, plan.IsolatedPipes);
    }
}
```

> `ICommandHandler<TCommand, TResult>` is the same interface `ReportIncidentCommandHandler` implements — confirm and match.

- [ ] **Step 6: Create the validator**

Create `RequestIsolationAnalysisCommandValidator.cs` (model on the existing `ClassifyIncidentCommandValidator`):

```csharp
using FluentValidation;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class RequestIsolationAnalysisCommandValidator
    : AbstractValidator<Commands.RequestIsolationAnalysisCommand>
{
    public RequestIsolationAnalysisCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty();
        RuleFor(x => x.StartNodeId).NotEmpty().WithMessage("A start node id is required for isolation analysis.");
    }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj --filter FullyQualifiedName~RequestIsolationAnalysisHandlerTests`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/ \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/RequestIsolationAnalysisHandlerTests.cs
git commit -m "feat(incident): INC-2 topology port + RequestIsolationAnalysis handler (INC-2)"
```

---

## Task 5: Integration event contract + mapper + contract test (TDD)

**Files:**
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Contracts/Events/IncidentIsolationPlanCreatedV1.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Contracts/IncidentEventTypes.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/IntegrationEvents/IncidentIntegrationEventMapper.cs`
- Test: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests/IncidentEventsContractTests.cs`

- [ ] **Step 1: Create the v1 event contract**

Create `IncidentIsolationPlanCreatedV1.cs`:

```csharp
namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>v1 payload for <c>incident.isolation-plan-created</c> (decision 0023).</summary>
public sealed record IncidentIsolationPlanCreatedV1(
    string IncidentId,
    string TenantId,
    string PlanId,
    string StartNodeId,
    long GraphVersion,
    IReadOnlyList<string> ValvesToClose,
    IReadOnlyList<string> IsolatedNodes,
    IReadOnlyList<string> IsolatedPipes,
    string ComputedBy);
```

- [ ] **Step 2: Add the event type constant**

In `IncidentEventTypes.cs`, add the constant (keep the existing three):

```csharp
    public const string IsolationPlanCreated = "incident.isolation-plan-created";
```

- [ ] **Step 3: Write the failing contract test**

Add to `IncidentEventsContractTests.cs`:

```csharp
    [Fact]
    public void IsolationPlanCreated_Event_Type_Is_Fixed()
    {
        IncidentEventTypes.IsolationPlanCreated.Should().Be("incident.isolation-plan-created");
    }

    [Fact]
    public void IncidentIsolationPlanCreated_V1_Schema_Is_Stable()
    {
        var evt = new IncidentIsolationPlanCreatedV1(
            "inc-1", "tenant-1", "plan-1", "node-1", 9,
            new[] { "v1" }, new[] { "node-1" }, new[] { "p1" }, "operator-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "PlanId", "StartNodeId", "GraphVersion",
                "ValvesToClose", "IsolatedNodes", "IsolatedPipes", "ComputedBy");
    }
```

- [ ] **Step 4: Run test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests/WaterNetwork.Incident.ContractTests.csproj`
Expected: FAIL — `IncidentIsolationPlanCreatedV1` / constant not found.

- [ ] **Step 5: Wire the mapper**

In `IncidentIntegrationEventMapper.cs`: add the integration-event record, the registry entry, and the map method.

Add the record (next to the other three):

```csharp
public sealed record IncidentIsolationPlanCreatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentIsolationPlanCreatedV1 Data)
    : IIntegrationEvent<IncidentIsolationPlanCreatedV1>;
```

Add to the `Registry` dictionary:

```csharp
            ["IncidentIsolationPlanCreated"] = e => e is IncidentIsolationPlanCreated x ? MapIsolationPlanCreated(x) : null,
```

Add the map method (and `using WaterNetwork.Incident.Domain.DomainEvents;` is already imported):

```csharp
    private static IncidentIsolationPlanCreatedIntegrationEvent MapIsolationPlanCreated(IncidentIsolationPlanCreated e)
        => new(e.EventId, IncidentEventTypes.IsolationPlanCreated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentIsolationPlanCreatedV1(e.AggregateId, e.Data.TenantId, e.Data.PlanId, e.Data.StartNodeId,
                e.Data.GraphVersion, e.Data.ValvesToClose, e.Data.IsolatedNodes, e.Data.IsolatedPipes, e.Data.ComputedBy));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests/WaterNetwork.Incident.ContractTests.csproj`
Expected: PASS (all contract tests).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Contracts/ \
        src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/IntegrationEvents/IncidentIntegrationEventMapper.cs \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests/IncidentEventsContractTests.cs
git commit -m "feat(incident): INC-2 incident.isolation-plan-created v1 contract + mapper (INC-2)"
```

---

## Task 6: Persistence — `isolation_plans` table + repository round-trip

**Files:**
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Persistence/Models/IsolationPlanModel.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Persistence/Configurations/IsolationPlanConfiguration.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Persistence/Models/NetworkIncidentPersistenceModel.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Persistence/Configurations/NetworkIncidentConfiguration.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Repositories/NetworkIncidentRepository.cs`
- Create (generated): migration under `.../Infrastructure/Persistence/Migrations/`
- Test: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/IsolationPlanPersistenceTests.cs`

- [ ] **Step 1: Create the persistence model**

Create `IsolationPlanModel.cs`:

```csharp
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
```

- [ ] **Step 2: Add the navigation to the aggregate model**

In `NetworkIncidentPersistenceModel.cs`, add a collection property alongside `AffectedAssets`/`TimelineEntries`:

```csharp
    public List<IsolationPlanModel> IsolationPlans { get; set; } = [];
```

- [ ] **Step 3: Create the EF configuration**

Create `IsolationPlanConfiguration.cs` (`List<string>` maps to Postgres `text[]` automatically under Npgsql):

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;

namespace WaterNetwork.Incident.Infrastructure.Persistence.Configurations;

public sealed class IsolationPlanConfiguration : IEntityTypeConfiguration<IsolationPlanModel>
{
    public void Configure(EntityTypeBuilder<IsolationPlanModel> builder)
    {
        builder.ToTable("isolation_plans");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.IncidentId).HasColumnName("incident_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.StartNodeId).HasColumnName("start_node_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.GraphVersion).HasColumnName("graph_version");
        builder.Property(x => x.ValvesToClose).HasColumnName("valves_to_close").HasColumnType("text[]");
        builder.Property(x => x.IsolatedNodes).HasColumnName("isolated_nodes").HasColumnType("text[]");
        builder.Property(x => x.IsolatedPipes).HasColumnName("isolated_pipes").HasColumnType("text[]");
        builder.Property(x => x.FailureReason).HasColumnName("failure_reason").HasMaxLength(1000);
        builder.Property(x => x.ComputedAt).HasColumnName("computed_at");
        builder.Property(x => x.Sequence).HasColumnName("sequence");
        builder.HasIndex(x => new { x.TenantId, x.IncidentId }).HasDatabaseName("ix_isolation_plans_tenant_incident");
    }
}
```

- [ ] **Step 4: Wire the relationship**

In `NetworkIncidentConfiguration.cs`, add after the `TimelineEntries` mapping:

```csharp
        builder.HasMany(x => x.IsolationPlans).WithOne().HasForeignKey(p => p.IncidentId).OnDelete(DeleteBehavior.Cascade);
```

- [ ] **Step 5: Update the repository to persist + rehydrate plans**

In `NetworkIncidentRepository.cs`:

(a) Add `.Include(x => x.IsolationPlans)` to **both** queries — `GetByIdAsync` and `PersistAsync`'s `existing` lookup.

(b) In `PersistAsync`'s `else` (mutation) branch, after the timeline append loop, reconcile plans (append new ones; update status of existing ones for supersede):

```csharp
            foreach (var plan in aggregate.IsolationPlans)
            {
                var row = existing.IsolationPlans.FirstOrDefault(p => p.Id == plan.Id);
                if (row is null)
                    existing.IsolationPlans.Add(ToModel(plan, aggregate.Id, aggregate.TenantId));
                else
                    row.Status = plan.Status.ToString();
            }
```

(c) In `ToModel(NetworkIncident)`, add the plans collection to the constructed model:

```csharp
            IsolationPlans = i.IsolationPlans.Select(p => ToModel(p, i.Id, i.TenantId)).ToList(),
```

(d) Add the plan `ToModel` helper next to the timeline one:

```csharp
    private static IsolationPlanModel ToModel(IsolationPlan p, string incidentId, string tenantId) => new()
    {
        Id = p.Id, IncidentId = incidentId, TenantId = tenantId, StartNodeId = p.StartNodeId,
        Status = p.Status.ToString(), GraphVersion = p.GraphVersion,
        ValvesToClose = [.. p.ValvesToClose], IsolatedNodes = [.. p.IsolatedNodes], IsolatedPipes = [.. p.IsolatedPipes],
        FailureReason = p.FailureReason, ComputedAt = p.ComputedAt, Sequence = p.Sequence
    };
```

(e) In `ToDomain`, pass plans into `Reconstitute` (new final argument):

```csharp
        m.IsolationPlans.OrderBy(p => p.Sequence).Select(p => IsolationPlan.Reconstitute(
            p.Id, Enum.Parse<IsolationPlanStatus>(p.Status), p.StartNodeId, p.GraphVersion,
            p.ValvesToClose, p.IsolatedNodes, p.IsolatedPipes, p.FailureReason, p.ComputedAt, p.Sequence)));
```

Add `using WaterNetwork.Incident.Domain.Entities;` (already present for `IncidentTimelineEntry`).

- [ ] **Step 6: Generate the migration**

Run:
```bash
dotnet ef migrations add AddIsolationPlans \
  --project src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure \
  --startup-project src/services/water-network-incident-be/src/WaterNetwork.Incident.Api
```
Expected: a new `*_AddIsolationPlans.cs` migration creating `isolation_plans` with `text[]` columns and the FK to `network_incidents`. Open it and confirm: `valves_to_close`/`isolated_nodes`/`isolated_pipes` are `text[]`, `graph_version` is `bigint`, FK `incident_id → network_incidents(id)` ON DELETE CASCADE.

- [ ] **Step 7: Write the round-trip integration test**

Create `IsolationPlanPersistenceTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

[Collection("incident-postgis")]
public sealed class IsolationPlanPersistenceTests(PostgisFixture postgis)
{
    [Fact]
    public async Task Plan_Survives_Save_And_Reload_With_Supersede()
    {
        using var factory = new IncidentApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkIncidentRepository>();

        var incident = NetworkIncident.Report("tenant-iso", IncidentCategory.PipeBurst, 3, 1, 1,
            [AssetRef.Create("node-1", AssetRefKind.Node, true)], "operator-1");
        incident.Classify(IncidentCategory.PipeBurst, 3, "operator-1", null);
        await repo.SaveAsync(incident, default);

        var reloaded = await repo.GetByIdAsync(incident.Id, default);
        reloaded!.RequestIsolationAnalysis("node-1", "operator-1");
        reloaded.RecordIsolationPlan(1, ["v1"], ["node-1"], ["p1"], "operator-1");
        await repo.SaveAsync(reloaded, default);

        var afterFirst = await repo.GetByIdAsync(incident.Id, default);
        afterFirst!.RequestIsolationAnalysis("node-1", "operator-1");
        afterFirst.RecordIsolationPlan(2, ["v2"], ["node-1"], [], "operator-1");
        await repo.SaveAsync(afterFirst, default);

        var final = await repo.GetByIdAsync(incident.Id, default);
        final!.Status.Should().Be(IncidentStatus.IsolationPlanReady);
        final.IsolationPlans.Count(p => p.Status == IsolationPlanStatus.Superseded).Should().Be(1);
        var active = final.IsolationPlans.Single(p => p.Status == IsolationPlanStatus.Proposed);
        active.GraphVersion.Should().Be(2);
        active.ValvesToClose.Should().Equal("v2");
    }
}
```

- [ ] **Step 8: Run the test**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj --filter FullyQualifiedName~IsolationPlanPersistenceTests`
Expected: PASS (1 test). (Requires Docker for `PostgisFixture`.)

- [ ] **Step 9: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/ \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/IsolationPlanPersistenceTests.cs
git commit -m "feat(incident): INC-2 persist isolation_plans + repository round-trip (INC-2)"
```

---

## Task 7: Surface isolation plans on the detail query

**Files:**
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/Dtos/IsolationPlanDto.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/Dtos/IncidentDetailDto.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Repositories/IncidentReadDao.cs`
- Test: extend `src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/IncidentApiTests.cs`

- [ ] **Step 1: Create the DTO**

Create `IsolationPlanDto.cs`:

```csharp
namespace WaterNetwork.Incident.Application.Dtos;

public sealed record IsolationPlanDto(
    string Id, string Status, string StartNodeId, long GraphVersion,
    IReadOnlyList<string> ValvesToClose, IReadOnlyList<string> IsolatedNodes, IReadOnlyList<string> IsolatedPipes,
    string? FailureReason, DateTime ComputedAt, int Sequence);
```

- [ ] **Step 2: Add the collection to `IncidentDetailDto`**

Append a parameter to `IncidentDetailDto` (after `Timeline`):

```csharp
    IReadOnlyList<TimelineEntryDto> Timeline,
    IReadOnlyList<IsolationPlanDto> IsolationPlans);
```

- [ ] **Step 3: Query plans in the read DAO**

In `IncidentReadDao.GetDetailAsync`, add a plans query, run it, and pass into the DTO. After `timelineSql`:

```csharp
        const string plansSql = """
            SELECT id AS Id, status AS Status, start_node_id AS StartNodeId, graph_version AS GraphVersion,
                   valves_to_close AS ValvesToClose, isolated_nodes AS IsolatedNodes, isolated_pipes AS IsolatedPipes,
                   failure_reason AS FailureReason, computed_at AS ComputedAt, sequence AS Sequence
            FROM isolation_plans
            WHERE incident_id = @incidentId AND tenant_id = @tenantId
            ORDER BY sequence
            """;
```

After the `timeline` query:

```csharp
        var plans = (await connection.QueryAsync<IsolationPlanDto>(
            new CommandDefinition(plansSql, args, cancellationToken: ct))).ToList();
```

Update the return to pass `plans` as the final argument:

```csharp
        return new IncidentDetailDto(
            head.Id, head.TenantId, head.Category, head.Severity, head.Longitude, head.Latitude,
            head.Status, head.ReportedBy, head.CancellationReason, head.CreatedAt, head.UpdatedAt, refs, timeline, plans);
```

> Dapper maps a Postgres `text[]` column to `List<string>`/`string[]` via Npgsql automatically. If a mapping error surfaces for the array columns, register once at DAO type-init: `SqlMapper.AddTypeHandler(...)` is **not** needed for `text[]` under Npgsql — Npgsql returns `string[]`, which Dapper assigns to `IReadOnlyList<string>`. If assignment fails, change the DTO array properties to `string[]`.

- [ ] **Step 4: Extend the API test (write failing assertion)**

Add to `IncidentApiTests.cs` — a test that drives analysis through the API once the endpoint exists (this test will fully pass after Task 9, but assert the detail shape now uses the stub provider, which Task 9 wires). Mark it to run after Task 9 by writing it here and verifying in Task 9. Add:

```csharp
    [Fact]
    public async Task Detail_Exposes_Empty_IsolationPlans_Initially()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);
        var id = await Report(client);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["isolationPlans"]!.AsArray().Should().BeEmpty();
    }
```

- [ ] **Step 5: Run the test**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj --filter FullyQualifiedName~Detail_Exposes_Empty_IsolationPlans_Initially`
Expected: PASS — detail now carries an (empty) `isolationPlans` array.

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/Dtos/ \
        src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Repositories/IncidentReadDao.cs \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/IncidentApiTests.cs
git commit -m "feat(incident): INC-2 expose isolation plans on incident detail (INC-2)"
```

---

## Task 8: gRPC client infrastructure — packages, proto, adapters, DI

**Files:**
- Modify: `Directory.Packages.props`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/WaterNetwork.Incident.Infrastructure.csproj`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Topology/TopologyOptions.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Topology/GrpcTopologyAnalysisAdapter.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/Topology/StubTopologyAnalysisAdapter.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Api/Program.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Api/appsettings.json`

- [ ] **Step 1: Add gRPC + Testcontainers base package versions**

In `Directory.Packages.props`, add inside the `<ItemGroup>`:

```xml
    <PackageVersion Include="Grpc.Net.Client" Version="2.71.0" />
    <PackageVersion Include="Grpc.Net.ClientFactory" Version="2.71.0" />
    <PackageVersion Include="Google.Protobuf" Version="3.31.1" />
    <PackageVersion Include="Grpc.Tools" Version="2.71.0" />
    <PackageVersion Include="Testcontainers" Version="4.4.0" />
```

- [ ] **Step 2: Reference proto + packages in the Infrastructure project**

In `WaterNetwork.Incident.Infrastructure.csproj`, add a package group and the `Protobuf` item (generates the **client** only):

```xml
  <ItemGroup>
    <PackageReference Include="Grpc.Net.Client" />
    <PackageReference Include="Grpc.Net.ClientFactory" />
    <PackageReference Include="Google.Protobuf" />
    <PackageReference Include="Grpc.Tools">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>
  <ItemGroup>
    <Protobuf Include="..\..\..\water-network-topology-rs\proto\topology.proto"
              GrpcServices="Client" Link="Proto\topology.proto" />
  </ItemGroup>
```

> The generated C# namespace for proto package `waternetwork.topology.v1` is `Waternetwork.Topology.V1`; the generated client is `TopologyService.TopologyServiceClient`. Do **not** edit `topology.proto` (it is the cross-language contract owned by topology-rs).

- [ ] **Step 3: Build the Infrastructure project to verify proto codegen**

Run: `dotnet build src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/WaterNetwork.Incident.Infrastructure.csproj`
Expected: Build succeeded; `Waternetwork.Topology.V1.TopologyService` types are generated. (If `protoc` download is blocked offline, the `Grpc.Tools` package vendors `protoc`; no system install needed.)

- [ ] **Step 4: Create `TopologyOptions`**

Create `Topology/TopologyOptions.cs`:

```csharp
namespace WaterNetwork.Incident.Infrastructure.Topology;

public sealed class TopologyOptions
{
    public const string SectionName = "Topology";

    /// <summary>"Grpc" (default) or "Stub".</summary>
    public string Provider { get; set; } = "Grpc";

    /// <summary>Topology-rs gRPC base address, e.g. http://water-network-topology-rs:50051.</summary>
    public string BaseUrl { get; set; } = "http://water-network-topology-rs:50051";

    /// <summary>Per-call deadline in seconds (roadmap §9.2: 5s).</summary>
    public int DeadlineSeconds { get; set; } = 5;
}
```

- [ ] **Step 5: Create the gRPC adapter**

Create `Topology/GrpcTopologyAnalysisAdapter.cs`:

```csharp
using Grpc.Core;
using Microsoft.Extensions.Options;
using Waternetwork.Topology.V1;
using WaterNetwork.Incident.Application.Ports;

namespace WaterNetwork.Incident.Infrastructure.Topology;

/// <summary>Real topology adapter — calls topology-rs ComputeIsolationZone over gRPC
/// (decisions 0019/0020/0023). Transport faults become <see cref="TopologyAnalysisException"/>;
/// the handler records an AnalysisFailed plan rather than surfacing the fault.</summary>
public sealed class GrpcTopologyAnalysisAdapter(
    TopologyService.TopologyServiceClient client,
    IOptions<TopologyOptions> options) : ITopologyAnalysisPort
{
    private readonly int _deadlineSeconds = options.Value.DeadlineSeconds;

    public async Task<IsolationZoneResult> ComputeIsolationZoneAsync(
        string tenantId, string startNodeId, CancellationToken ct = default)
    {
        try
        {
            var response = await client.ComputeIsolationZoneAsync(
                new ComputeIsolationZoneRequest { TenantId = tenantId, StartNodeId = startNodeId },
                deadline: DateTime.UtcNow.AddSeconds(_deadlineSeconds), cancellationToken: ct);

            return new IsolationZoneResult(
                response.ValvesToClose.ToList(),
                response.IsolatedNodes.ToList(),
                response.IsolatedPipes.ToList(),
                (long)response.GraphVersion);
        }
        catch (RpcException ex)
        {
            throw new TopologyAnalysisException(
                $"Topology isolation analysis failed ({ex.StatusCode}): {ex.Status.Detail}", ex);
        }
    }
}
```

- [ ] **Step 6: Create the stub adapter**

Create `Topology/StubTopologyAnalysisAdapter.cs` (used by API integration tests via `Topology:Provider=Stub`; returns a deterministic non-empty zone, or throws when the start node sentinel `__fail__` is passed so failure paths are testable):

```csharp
using WaterNetwork.Incident.Application.Ports;

namespace WaterNetwork.Incident.Infrastructure.Topology;

/// <summary>Config-swapped test/dev adapter (Topology:Provider=Stub). Returns a fixed
/// isolation zone; the sentinel start node "__fail__" simulates a topology outage.</summary>
public sealed class StubTopologyAnalysisAdapter : ITopologyAnalysisPort
{
    public Task<IsolationZoneResult> ComputeIsolationZoneAsync(string tenantId, string startNodeId, CancellationToken ct = default)
    {
        if (startNodeId == "__fail__")
            throw new TopologyAnalysisException("stub: simulated topology outage");

        return Task.FromResult(new IsolationZoneResult(
            ValvesToClose: ["valve-stub-1"],
            IsolatedNodes: [startNodeId],
            IsolatedPipes: ["pipe-stub-1"],
            GraphVersion: 42));
    }
}
```

- [ ] **Step 7: Wire DI in `Program.cs`**

In `Program.cs`, add the `using` lines:

```csharp
using Grpc.Net.Client.Configuration;
using WaterNetwork.Incident.Infrastructure.Topology;
```

Replace the `GisLookup` registration block's neighbourhood with the topology provider switch (place after the existing `AddSingleton<IGisLookupPort, StubGisLookupAdapter>()` line):

```csharp
builder.Services.Configure<TopologyOptions>(builder.Configuration.GetSection(TopologyOptions.SectionName));
var topologyProvider = builder.Configuration.GetValue<string>($"{TopologyOptions.SectionName}:Provider") ?? "Grpc";
if (string.Equals(topologyProvider, "Stub", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddSingleton<ITopologyAnalysisPort, StubTopologyAnalysisAdapter>();
}
else
{
    var topologyBaseUrl = builder.Configuration.GetValue<string>($"{TopologyOptions.SectionName}:BaseUrl")
        ?? "http://water-network-topology-rs:50051";
    builder.Services.AddGrpcClient<Waternetwork.Topology.V1.TopologyService.TopologyServiceClient>(o =>
        {
            o.Address = new Uri(topologyBaseUrl);
        })
        .ConfigureChannel(ch => ch.ServiceConfig = new ServiceConfig
        {
            MethodConfigs =
            {
                new MethodConfig
                {
                    Names = { MethodName.Default },
                    RetryPolicy = new RetryPolicy
                    {
                        MaxAttempts = 3,
                        InitialBackoff = TimeSpan.FromMilliseconds(200),
                        MaxBackoff = TimeSpan.FromSeconds(2),
                        BackoffMultiplier = 2,
                        RetryableStatusCodes = { StatusCode.Unavailable, StatusCode.DeadlineExceeded }
                    }
                }
            }
        });
    builder.Services.AddScoped<ITopologyAnalysisPort, GrpcTopologyAnalysisAdapter>();
}
```

Add `using WaterNetwork.Incident.Application.Ports;` and `using Grpc.Core;` if not already resolved.

- [ ] **Step 8: Add config defaults to `appsettings.json`**

In `appsettings.json`, add a `Topology` section (sibling of the existing `GisLookup` section):

```json
  "Topology": {
    "Provider": "Grpc",
    "BaseUrl": "http://water-network-topology-rs:50051",
    "DeadlineSeconds": 5
  }
```

- [ ] **Step 9: Build the whole service solution**

Run: `dotnet build src/services/water-network-incident-be/WaterNetwork.Incident.slnx`
Expected: Build succeeded, 0 warnings.

- [ ] **Step 10: Commit**

```bash
git add Directory.Packages.props src/services/water-network-incident-be/src/
git commit -m "feat(incident): INC-2 gRPC topology client + Stub/Grpc provider swap (INC-2)"
```

---

## Task 9: API endpoint + API integration tests (TDD via stub provider)

**Files:**
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Api/Requests/RequestIsolationAnalysisRequest.cs`
- Create: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Api/Validators/RequestIsolationAnalysisRequestValidator.cs`
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Api/Endpoints/IncidentsEndpointModule.cs`
- Test: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/IncidentIsolationApiTests.cs`

- [ ] **Step 1: Create the request + validator**

Create `Requests/RequestIsolationAnalysisRequest.cs`:

```csharp
namespace WaterNetwork.Incident.Api.Requests;

public sealed record RequestIsolationAnalysisRequest(string StartNodeId);
```

Create `Validators/RequestIsolationAnalysisRequestValidator.cs` (model on `ClassifyIncidentRequestValidator`):

```csharp
using FluentValidation;
using WaterNetwork.Incident.Api.Requests;

namespace WaterNetwork.Incident.Api.Validators;

public sealed class RequestIsolationAnalysisRequestValidator : AbstractValidator<RequestIsolationAnalysisRequest>
{
    public RequestIsolationAnalysisRequestValidator()
    {
        RuleFor(x => x.StartNodeId).NotEmpty().WithMessage("startNodeId is required.");
    }
}
```

- [ ] **Step 2: Write the failing API test**

Create `IncidentIsolationApiTests.cs` (drives the real handler with the **stub** topology provider):

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
public sealed class IncidentIsolationApiTests(PostgisFixture postgis)
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
            permissions: ["network-incident:write", "network-incident:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> ReportAndClassify(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/incidents", new
        {
            category = "PipeBurst", severity = 3,
            affectedRefs = new[] { new { assetId = "node-1", kind = "Node" } }
        });
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        await client.PostAsJsonAsync($"/api/incidents/{id}/classify", new { category = "PipeBurst", severity = 3, note = (string?)null });
        return id;
    }

    [Fact]
    public async Task Analysis_Success_Returns_Plan_And_Sets_Ready()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        var id = await ReportAndClassify(client);

        var resp = await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "node-1" });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = (await resp.Content.ReadFromJsonAsync<JsonNode>())!;
        body["status"]!.GetValue<string>().Should().Be("Proposed");
        body["incidentStatus"]!.GetValue<string>().Should().Be("IsolationPlanReady");
        body["valvesToClose"]!.AsArray().Should().ContainSingle();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("IsolationPlanReady");
        detail["isolationPlans"]!.AsArray().Should().ContainSingle();
    }

    [Fact]
    public async Task Analysis_Topology_Failure_Returns_AnalysisFailed_Retryable()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        var id = await ReportAndClassify(client);

        var resp = await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "__fail__" });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = (await resp.Content.ReadFromJsonAsync<JsonNode>())!;
        body["status"]!.GetValue<string>().Should().Be("AnalysisFailed");
        body["incidentStatus"]!.GetValue<string>().Should().Be("IsolationRequested");

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("IsolationRequested");
    }

    [Fact]
    public async Task Analysis_On_Reported_Incident_Returns_422()
    {
        using var factory = StubFactory(postgis);
        using var client = Client(factory);
        var resp0 = await client.PostAsJsonAsync("/api/incidents", new { category = "Leak", severity = 2 });
        var id = (await resp0.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var resp = await client.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "node-1" });
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Analysis_On_Other_Tenants_Incident_Returns_404()
    {
        using var factory = StubFactory(postgis);
        using var t1 = Client(factory, "tenant-1");
        using var t2 = Client(factory, "tenant-2");
        var id = await ReportAndClassify(t1);

        var resp = await t2.PostAsJsonAsync($"/api/incidents/{id}/isolation-analysis", new { startNodeId = "node-1" });
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
```

> Confirm the `BusinessRuleException` → HTTP status mapping in `GlobalExceptionMiddleware`: INC-1 maps business-rule violations to **422** (see `AssetAlreadyDecommissioned`/roadmap). If the middleware maps to a different code, adjust `Analysis_On_Reported_Incident_Returns_422` to match the actual mapping.

- [ ] **Step 3: Run the test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj --filter FullyQualifiedName~IncidentIsolationApiTests`
Expected: FAIL — endpoint `POST /api/incidents/{id}/isolation-analysis` returns 404 (not mapped).

- [ ] **Step 4: Add the endpoint**

In `IncidentsEndpointModule.cs`, add inside `MapEndpoints` after the `cancel` mapping. Add `using WaterNetwork.Incident.Application.Dtos;`:

```csharp
        group.MapPost("/{id}/isolation-analysis", async Task<Ok<IsolationAnalysisResultDto>> (
                string id, RequestIsolationAnalysisRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                var result = await bus.ExecuteAsync(
                    new RequestIsolationAnalysisCommand(id, request.StartNodeId), ct);
                return TypedResults.Ok(result);
            })
            .WithValidation<RequestIsolationAnalysisRequest>()
            .RequirePermission("network-incident:write");
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj --filter FullyQualifiedName~IncidentIsolationApiTests`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Api/ \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/IncidentIsolationApiTests.cs
git commit -m "feat(incident): INC-2 isolation-analysis endpoint + API integration tests (INC-2)"
```

---

## Task 10: gRPC wire-compat contract test (real topology image)

**Files:**
- Modify: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj`
- Create: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/TopologyContainerFixture.cs`
- Create: `src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/TopologyGrpcContractTests.cs`

This closes the decision 0019 follow-up: the .NET client generated from `proto/topology.proto` is validated against the **actual Rust binary**. An unknown-tenant call must return a well-formed empty response (decision 0020 §5).

- [ ] **Step 1: Add test packages**

In `WaterNetwork.Incident.IntegrationTests.csproj`, add to the `PackageReference` group:

```xml
    <PackageReference Include="Testcontainers" />
    <PackageReference Include="Grpc.Net.Client" />
```

(The `Waternetwork.Topology.V1` client and `GrpcTopologyAnalysisAdapter` come transitively through the `WaterNetwork.Incident.Api` project reference → Infrastructure.)

- [ ] **Step 2: Create the container fixture**

Create `TopologyContainerFixture.cs` — builds the Rust image from the repo Dockerfile (build context = git root) and starts it with an unreachable AMQP url so the consumer loop retries harmlessly while the gRPC port serves:

```csharp
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using DotNet.Testcontainers.Images;

namespace WaterNetwork.Incident.IntegrationTests;

public sealed class TopologyContainerFixture : IAsyncLifetime
{
    private IFutureDockerImage _image = default!;
    private IContainer _container = default!;

    public string GrpcAddress { get; private set; } = default!;

    public async Task InitializeAsync()
    {
        _image = new ImageFromDockerfileBuilder()
            .WithDockerfileDirectory(CommonDirectoryPath.GetGitDirectory(), string.Empty)
            .WithDockerfile("src/services/water-network-topology-rs/Dockerfile")
            .WithName("water-network-topology-rs:inc2-contract")
            .WithCleanUp(false)
            .Build();
        await _image.CreateAsync();

        _container = new ContainerBuilder()
            .WithImage(_image)
            // Unreachable broker: the consumer loop retries every 5s; the gRPC server (spawned first) still serves.
            .WithEnvironment("TOPOLOGY_AMQP_URL", "amqp://guest:guest@127.0.0.1:1/%2f")
            .WithEnvironment("TOPOLOGY_GRPC_BIND", "0.0.0.0:50051")
            .WithEnvironment("TOPOLOGY_HTTP_BIND", "0.0.0.0:8080")
            .WithPortBinding(50051, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilPortIsAvailable(50051))
            .Build();
        await _container.StartAsync();

        GrpcAddress = $"http://{_container.Hostname}:{_container.GetMappedPublicPort(50051)}";
    }

    public async Task DisposeAsync()
    {
        if (_container is not null) await _container.DisposeAsync();
        if (_image is not null) await _image.DisposeAsync();
    }
}
```

- [ ] **Step 3: Write the contract test**

Create `TopologyGrpcContractTests.cs` — exercises the real adapter against the running Rust server:

```csharp
using FluentAssertions;
using Grpc.Net.Client;
using Microsoft.Extensions.Options;
using Waternetwork.Topology.V1;
using WaterNetwork.Incident.Infrastructure.Topology;

namespace WaterNetwork.Incident.IntegrationTests;

public sealed class TopologyGrpcContractTests(TopologyContainerFixture topology) : IClassFixture<TopologyContainerFixture>
{
    [Fact]
    public async Task ComputeIsolationZone_Unknown_Tenant_Returns_WellFormed_Empty_Response()
    {
        using var channel = GrpcChannel.ForAddress(topology.GrpcAddress);
        var client = new TopologyService.TopologyServiceClient(channel);
        var adapter = new GrpcTopologyAnalysisAdapter(client, Options.Create(new TopologyOptions { DeadlineSeconds = 5 }));

        var result = await adapter.ComputeIsolationZoneAsync("tenant-unknown", "node-unknown", default);

        // Decision 0020 §5: unknown tenant/start node → empty lists, no error.
        result.ValvesToClose.Should().BeEmpty();
        result.IsolatedNodes.Should().BeEmpty();
        result.IsolatedPipes.Should().BeEmpty();
        result.GraphVersion.Should().BeGreaterThanOrEqualTo(0);
    }
}
```

> This proves the .NET-generated protobuf client and the Rust tonic server agree on the `ComputeIsolationZone` wire format. The empty-graph path is deterministic and needs no RabbitMQ. A graph-seeded e2e (publish events → assert specific valves) is already covered on the Rust side (TOP-3 grpcurl + integration test); it remains a backlog follow-up if a cross-language seeded assertion is later wanted.

- [ ] **Step 4: Run the contract test**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj --filter FullyQualifiedName~TopologyGrpcContractTests`
Expected: PASS (1 test). First run builds the Rust image (~2-3 min, cached afterwards). Requires Docker.

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/
git commit -m "test(incident): INC-2 gRPC wire-compat contract test vs real topology image (INC-2)"
```

---

## Task 11: Compose wiring, docs, full green

**Files:**
- Modify: `docker-compose.yml` (incident-be service block)
- Modify: `src/services/water-network-incident-be/src/WaterNetwork.Incident.Api/appsettings.json` (already done in Task 8 — verify only)
- Modify: `docs/stories/backlog.md`
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`
- Modify: `docs/conventions/template-mapping.md`

- [ ] **Step 1: Wire compose dependency + env**

In `docker-compose.yml`, find the `water-network-incident-be` service. Add the topology dependency and gRPC env (match the indentation/style of the existing GIS env vars):

```yaml
    environment:
      # ... existing vars ...
      - Topology__Provider=Grpc
      - Topology__BaseUrl=http://water-network-topology-rs:50051
    depends_on:
      # ... existing deps ...
      water-network-topology-rs:
        condition: service_started
```

> Verify the exact existing keys/format in the incident-be block before editing; merge into the existing `environment`/`depends_on` rather than duplicating them. Confirm the topology service name in compose is `water-network-topology-rs` and that it publishes 50051.

- [ ] **Step 2: Update the backlog**

In `docs/stories/backlog.md`:
- Change the Phase 3 status line to include `INC-2 done`: `... (TOP-1..3 done, INC-1 done, INC-2 done)`.
- Add a "Follow-up sau INC-2" section summarizing: gRPC topology port + GrpcTopologyAnalysisAdapter (Provider swap), synchronous analysis with AnalysisFailed-retryable, isolation_plans persistence, event `incident.isolation-plan-created` v1, wire-compat contract test (closes decision 0019 deferral); and carry-forward follow-ups: pipe/device assetRef→node resolution still deferred; graph-seeded cross-language e2e deferred; valve open/closed state (Phase 5); `network-incident:confirm` + plan Confirmed = INC-3.

- [ ] **Step 3: Tick the roadmap checkbox**

In `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §3.3, mark the INC-2 row done (add ` ✓` like the other completed slices) and update §9.3 item 2 (INC-2) to past-tense "SHIPPED" with a one-line summary mirroring the INC-1/TOP entries.

- [ ] **Step 4: Note the gRPC-client pattern in template-mapping**

In `docs/conventions/template-mapping.md`, add a short subsection: ".NET gRPC client to a Rust service" — proto reference via `Grpc.Tools` `<Protobuf GrpcServices="Client">` pointing at the owning service's committed `.proto`; generated namespace = PascalCase of the proto package; `AddGrpcClient` + `ServiceConfig` retry + per-call deadline; `Topology:Provider` Stub/Grpc swap mirrors `GisLookup:Provider`; contract test = Testcontainers real image, empty-graph wire-compat.

- [ ] **Step 5: Run the full service test suite**

Run each test project (per CLAUDE.md `.slnx` footgun — run projects individually):
```bash
dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj
dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests/WaterNetwork.Incident.ContractTests.csproj
dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj
```
Expected: all green, 0 warnings. (Integration + contract tests require Docker.)

- [ ] **Step 6: Verify no other service regressed from shared changes**

Only `Directory.Packages.props` was a shared edit (added package versions — additive, no version bumps to existing packages). Build the building-blocks + one consumer to confirm no central-package conflict:
```bash
dotnet build src/services/water-network-gis-be/WaterNetwork.Gis.slnx
```
Expected: Build succeeded (sanity that the added `PackageVersion` entries don't disturb other services).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml docs/
git commit -m "chore(incident): INC-2 compose wiring + backlog/roadmap/template-mapping (INC-2)"
```

---

## Self-Review (completed during planning)

- **Spec coverage (US-P3-04 / roadmap §9.3 INC-2):** `RequestIsolationAnalysis` command + port + gRPC adapter (Tasks 4, 8); `IsolationPlan` snapshot + supersede (Tasks 2, 3, 6); event `incident.isolation-plan-created` (Task 5); failure path → AnalysisFailed retryable (Tasks 3, 4, 9); contract test vs real topology container — the decision 0019 deferral (Task 10); `Grpc.Net.Client` added to `Directory.Packages.props` per roadmap §9.3 (Task 8). All covered.
- **Type consistency:** `IsolationZoneResult`, `IsolationAnalysisResultDto`, `IsolationPlan` (factories `Proposed`/`Failed`/`AsSuperseded`/`Reconstitute`), `ITopologyAnalysisPort.ComputeIsolationZoneAsync`, `TopologyAnalysisException`, `Topology:Provider`/`BaseUrl`/`DeadlineSeconds`, generated `Waternetwork.Topology.V1.TopologyService.TopologyServiceClient` + `ComputeIsolationZoneRequest`/`Response` — names used identically across tasks.
- **Verification gaps flagged inline:** marker-interface name (`ICommand<T>`/`ICommandHandler<T,R>`), `TenantContext`/`RequestContext` constructors, `BusinessRuleException`→HTTP-status mapping, `ClearDomainEvents` helper name, and Dapper `text[]`→`IReadOnlyList<string>` assignment each carry a `>` note to confirm against the building blocks before relying on them.
- **No placeholders:** every code step contains complete code; the only generated artifact is the EF migration (Task 6 Step 6), produced by `dotnet ef` with explicit verification of its column types.
