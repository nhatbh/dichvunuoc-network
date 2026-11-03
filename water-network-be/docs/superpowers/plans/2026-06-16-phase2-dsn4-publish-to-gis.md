# DSN-4 Publish → GIS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an `Approved` design revision into GIS via a two-way event flow (design-be → `design.asset.ready-for-gis` → gis-be import → `network.gis-import.completed` → design-be), making the revision `Published`/`PartiallyPublished` with an idempotent, auditable import.

**Architecture:** design-be consumes its own `design.revision.approved` (outbox-backed), loads the revision's drafts, and raises `DesignAssetReadyForGis` (batch payload) → outbox → bus. gis-be consumes it, imports drafts in order Node→Pipe→Device through the existing domain factories (`NetworkNode.Register`/`NetworkPipe.Register`/`NetworkDevice.Install`) + repositories (tenant from payload), deduplicates per `(revisionId, draftAssetId)` via a `gis_import_ledger`, resolves intra-batch `clientRef` references, then raises `NetworkGisImportCompleted {imported[], failed[]}` → bus. design-be consumes the completion event and calls `DesignRevision.MarkPublished`, persisting an import report.

**Tech Stack:** .NET 10, EF Core + Npgsql + NetTopologySuite (PostGIS), MassTransit (RabbitMQ / InMemory for tests), building-blocks outbox/inbox (`IdempotentEnvelopeConsumer`, `IInboxMessageStore`, `IOutboxRepository`, `AggregateRepositoryBase`), xUnit + FluentAssertions + Testcontainers.

**Reference patterns (read before starting):**
- Consumer base: `src/building-blocks/src/WaterPlatform.BuildingBlocks.EventBus/Integration/IdempotentEnvelopeConsumer.cs`
- Mirror consumer (subscribe + read payload): `src/services/water-network-gis-be/.../Consumers/AssetLifecycleProjectionConsumer.cs`
- Mirror consumer (create via factory + repo, tenant from payload, 23505 catch): `src/services/water-network-asset-be/.../Consumers/GisAssetRegistrationConsumer.cs`
- Outbox mapper registry: `src/services/water-network-design-be/.../IntegrationEvents/DesignIntegrationEventMapper.cs`
- DSN-3 transition/status precedent: `src/services/water-network-design-be/.../Aggregates/DesignRevision.cs`

**Spec:** `docs/superpowers/specs/2026-06-16-dsn4-publish-to-gis-design.md`

---

## File Structure

**Contracts (shared, referenced by both services)**
- `water-network-design-be/.../WaterNetwork.Design.Contracts/DesignEventTypes.cs` — add `RevisionPublished`, `AssetReadyForGis` constants (modify)
- `water-network-design-be/.../WaterNetwork.Design.Contracts/Events/DesignAssetReadyForGisV1.cs` — new payload (create)
- `water-network-design-be/.../WaterNetwork.Design.Contracts/Events/DesignRevisionPublishedV1.cs` — new payload (create)
- `water-network-gis-be/.../WaterNetwork.Gis.Contracts/GisEventTypes.cs` (or existing event-types file) — add `GisImportCompleted` constant (modify/create)
- `water-network-gis-be/.../WaterNetwork.Gis.Contracts/Events/NetworkGisImportCompletedV1.cs` — new payload (create)

**design-be domain & status**
- `.../WaterNetwork.Design.Domain/ValueObjects/DesignRevisionStatus.cs` — add `Published`, `PartiallyPublished` (modify)
- `.../WaterNetwork.Design.Domain/Aggregates/DesignRevision.cs` — add `BeginPublish`, `MarkPublished` (modify)
- `.../WaterNetwork.Design.Domain/DomainEvents/DesignAssetReadyForGis.cs` — new domain event + data (create)
- `.../WaterNetwork.Design.Domain/DomainEvents/DesignRevisionPublished.cs` — new domain event + data (create)
- `.../WaterNetwork.Design.Domain/ValueObjects/DraftAssetSnapshot.cs` — DTO passed into `BeginPublish` (create)

**design-be infrastructure**
- `.../WaterNetwork.Design.Infrastructure/IntegrationEvents/DesignIntegrationEventMapper.cs` — map 2 new domain events (modify)
- `.../WaterNetwork.Design.Infrastructure/Consumers/RevisionApprovedPublishConsumer.cs` — new (create)
- `.../WaterNetwork.Design.Infrastructure/Consumers/GisImportCompletedConsumer.cs` — new (create)
- `.../WaterNetwork.Design.Infrastructure/Persistence/DesignImportResultPersistenceModel.cs` — new (create)
- `.../WaterNetwork.Design.Infrastructure/Persistence/Configurations/DesignImportResultConfiguration.cs` — new (create)
- `.../WaterNetwork.Design.Infrastructure/Persistence/Migrations/<ts>_AddDesignImportResults.cs` — generated (create)
- `.../WaterNetwork.Design.Infrastructure/Repositories/DesignImportResultStore.cs` — new (create)
- `.../WaterNetwork.Design.Infrastructure/Repositories/DesignRevisionReadDao.cs` — add `ListImportResultsAsync` (modify)
- `.../WaterNetwork.Design.Application/Ports/IDesignImportResultStore.cs` + `IDesignRevisionReadDao.cs` — new port + add method (create/modify)
- `.../WaterNetwork.Design.Application/Dtos/ImportResultDto.cs` — new (create)
- `.../WaterNetwork.Design.Application/Queries/GetRevisionPublishResultQuery.cs` (+ handler) — new (create)
- `.../WaterNetwork.Design.Api/Endpoints/RevisionsEndpointModule.cs` — add GET publish-result (modify)
- `.../WaterNetwork.Design.Api/Program.cs` — register 2 consumers + bus config (modify)

**gis-be import**
- `.../WaterNetwork.Gis.Domain/DomainEvents/NetworkGisImportCompleted.cs` — new domain event + data (create)
- `.../WaterNetwork.Gis.Domain/Aggregates/GisImportBatch.cs` — tiny aggregate that raises the completion event (create)
- `.../WaterNetwork.Gis.Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs` — map completion event (modify)
- `.../WaterNetwork.Gis.Infrastructure/Consumers/DesignAssetImportConsumer.cs` — new (create)
- `.../WaterNetwork.Gis.Infrastructure/Consumers/DraftAssetMapper.cs` — attribute→factory mapping (create)
- `.../WaterNetwork.Gis.Infrastructure/Persistence/GisImportLedgerPersistenceModel.cs` — new (create)
- `.../WaterNetwork.Gis.Infrastructure/Persistence/Configurations/GisImportLedgerConfiguration.cs` — new (create)
- `.../WaterNetwork.Gis.Infrastructure/Persistence/Migrations/<ts>_AddGisImportLedger.cs` — generated (create)
- `.../WaterNetwork.Gis.Infrastructure/Repositories/GisImportLedgerStore.cs` (+ `IGisImportLedgerStore` port) — new (create)
- `.../WaterNetwork.Gis.Api/Program.cs` — register consumer + bus config (modify)

**Tests**
- `WaterNetwork.Design.UnitTests/DesignRevisionPublishTransitionTests.cs`
- `WaterNetwork.Design.ContractTests/DesignPublishEventsContractTests.cs`
- `WaterNetwork.Design.IntegrationTests/RevisionPublishFlowTests.cs`
- `WaterNetwork.Gis.UnitTests/DraftAssetMapperTests.cs`
- `WaterNetwork.Gis.ContractTests/GisImportCompletedContractTests.cs`
- `WaterNetwork.Gis.IntegrationTests/DesignAssetImportConsumerTests.cs`
- `WaterNetwork.Design.IntegrationTests/PublishRoundTripTests.cs` (cross-service, shared broker)

---

## Conventions reused (do not reinvent)

- **Integration event record shape** (positional): `(string EventId, string EventType, int EventVersion, DateTime OccurredAt, string SourceAggregateId, string SourceAggregateType, TData Data)` — mirror `DesignRevisionApprovedIntegrationEvent`.
- **Domain event** registry key = the domain event class simple name (e.g. `"DesignAssetReadyForGis"`); the mapper registry maps that string.
- **Outbox domain-event types** auto-registered via `AddOutboxDomainEventTypesFromAssembly(typeof(<a domain event>).Assembly)` already in both `Program.cs` — new domain events in the same Domain assembly need NO Program change for outbox typing.
- **Consumer registration**: `builder.Services.AddScoped<TConsumer>();` + `AddPlatformEventBus(cfg, bus => bus.AddConsumer<TConsumer>());`
- **Coordinate order**: draft `DraftGeometry` coords are `GeoCoordinate(X=lng, Y=lat)`; GIS `GeoPoint(latitude, longitude)`. Always map `GeoPoint(c.Y, c.X)`.
- **Route prefix** (design-be): `/api/design/...`; **permissions**: `network-design:read|write|approve`.
- **Migration command** (per CLAUDE.md footgun — never `dotnet ef` against `.slnx`): run from the Infrastructure project dir with explicit startup project, see Task 8/11 for exact command.

---

## Task 1: Contracts — `design.asset.ready-for-gis` v1 payload + event type

**Files:**
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/DesignEventTypes.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/Events/DesignAssetReadyForGisV1.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/Events/DesignRevisionPublishedV1.cs`

- [ ] **Step 1: Add event-type constants**

In `DesignEventTypes.cs` add to the class body:
```csharp
    public const string AssetReadyForGis = "design.asset.ready-for-gis";
    public const string RevisionPublished = "design.revision.published";
```

- [ ] **Step 2: Create the ready-for-gis v1 payload**

`Events/DesignAssetReadyForGisV1.cs`:
```csharp
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.asset.ready-for-gis</c> — a full revision batch.</summary>
public sealed record DesignAssetReadyForGisV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ApprovedBy,
    IReadOnlyList<ReadyForGisAssetV1> Assets);

/// <summary>One draft asset in a ready-for-gis batch. <c>Geometry</c> coordinates are GeoJSON [lng, lat].</summary>
public sealed record ReadyForGisAssetV1(
    string DraftAssetId,
    string Kind,                  // "Node" | "Pipe" | "Device"
    string AssetCode,
    string? ClientRef,
    ReadyForGisGeometryV1 Geometry,
    IReadOnlyDictionary<string, string> Attributes,
    string? FromRef,
    string? ToRef,
    string? HostRef);

public sealed record ReadyForGisGeometryV1(
    string Type,                  // "Point" | "LineString"
    IReadOnlyList<IReadOnlyList<double>> Coordinates);  // [[lng,lat], ...]
```

- [ ] **Step 3: Create the revision-published v1 payload**

`Events/DesignRevisionPublishedV1.cs`:
```csharp
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.revision.published</c> (terminal: Published or PartiallyPublished).</summary>
public sealed record DesignRevisionPublishedV1(
    string RevisionId,
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string Status,                // "Published" | "PartiallyPublished"
    int ImportedCount,
    int FailedCount);
```

- [ ] **Step 4: Build the Contracts project**

Run: `dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Contracts/WaterNetwork.Design.Contracts.csproj --nologo`
Expected: Build succeeded, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Contracts
git commit -m "feat(design): DSN-4 ready-for-gis + revision-published v1 contracts (DSN-4)"
```

---

## Task 2: Contracts — `network.gis-import.completed` v1 payload + event type

**Files:**
- Modify/Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Contracts/GisEventTypes.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Contracts/Events/NetworkGisImportCompletedV1.cs`

- [ ] **Step 1: Add the event-type constant**

Find the GIS event-types holder (grep `network.node.registered` under `WaterNetwork.Gis.Contracts`). Add to that static class:
```csharp
    public const string GisImportCompleted = "network.gis-import.completed";
```
If no such class exists in Contracts, create `GisEventTypes.cs`:
```csharp
namespace WaterNetwork.Gis.Contracts;

public static class GisEventTypes
{
    public const string GisImportCompleted = "network.gis-import.completed";
}
```
(Do NOT duplicate existing node/pipe/device constants — only add the new one to wherever they already live.)

- [ ] **Step 2: Create the completion v1 payload**

`Events/NetworkGisImportCompletedV1.cs`:
```csharp
namespace WaterNetwork.Gis.Contracts.Events;

/// <summary>v1 payload for <c>network.gis-import.completed</c>.</summary>
public sealed record NetworkGisImportCompletedV1(
    string RevisionId,
    string TenantId,
    IReadOnlyList<GisImportedAssetV1> Imported,
    IReadOnlyList<GisImportFailureV1> Failed);

public sealed record GisImportedAssetV1(
    string DraftAssetId,
    string GisAssetId,
    string Kind,
    string AssetCode);

public sealed record GisImportFailureV1(
    string DraftAssetId,
    string AssetCode,
    string Reason);
```

- [ ] **Step 3: Build the Contracts project**

Run: `dotnet build src/services/water-network-gis-be/src/WaterNetwork.Gis.Contracts/WaterNetwork.Gis.Contracts.csproj --nologo`
Expected: Build succeeded, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Contracts
git commit -m "feat(gis): DSN-4 gis-import-completed v1 contract (DSN-4)"
```

---

## Task 3: Contract tests for both events (shape lock)

**Files:**
- Create: `src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/DesignPublishEventsContractTests.cs`
- Create: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/GisImportCompletedContractTests.cs`

Mirror the existing `DesignRevisionEventsContractTests.cs` style (serialize payload, assert JSON property names — locking the wire contract).

- [ ] **Step 1: Write the design contract test**

```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Design.Contracts.Events;
using Xunit;

namespace WaterNetwork.Design.ContractTests;

public sealed class DesignPublishEventsContractTests
{
    [Fact]
    public void ReadyForGis_v1_serializes_expected_fields()
    {
        var payload = new DesignAssetReadyForGisV1(
            "rev-1", "proj-1", "tenant-1", 2, "user-1",
            new[]
            {
                new ReadyForGisAssetV1("d1", "Node", "N-1", "cr-1",
                    new ReadyForGisGeometryV1("Point", new[] { new double[] { 106.7, 10.8 } }),
                    new Dictionary<string, string> { ["nodeType"] = "Junction" },
                    null, null, null)
            });

        var json = JsonSerializer.Serialize(payload);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        root.GetProperty("RevisionId").GetString().Should().Be("rev-1");
        root.GetProperty("ApprovedBy").GetString().Should().Be("user-1");
        var asset = root.GetProperty("Assets")[0];
        asset.GetProperty("Kind").GetString().Should().Be("Node");
        asset.GetProperty("Geometry").GetProperty("Type").GetString().Should().Be("Point");
        asset.GetProperty("Geometry").GetProperty("Coordinates")[0][0].GetDouble().Should().Be(106.7);
        asset.GetProperty("Attributes").GetProperty("nodeType").GetString().Should().Be("Junction");
    }

    [Fact]
    public void RevisionPublished_v1_serializes_expected_fields()
    {
        var payload = new DesignRevisionPublishedV1("rev-1", "proj-1", "tenant-1", 2, "PartiallyPublished", 3, 1);
        var json = JsonSerializer.Serialize(payload);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("Status").GetString().Should().Be("PartiallyPublished");
        doc.RootElement.GetProperty("ImportedCount").GetInt32().Should().Be(3);
        doc.RootElement.GetProperty("FailedCount").GetInt32().Should().Be(1);
    }
}
```

- [ ] **Step 2: Write the gis contract test**

```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using Xunit;

namespace WaterNetwork.Gis.ContractTests;

public sealed class GisImportCompletedContractTests
{
    [Fact]
    public void GisImportCompleted_v1_serializes_expected_fields()
    {
        var payload = new NetworkGisImportCompletedV1(
            "rev-1", "tenant-1",
            new[] { new GisImportedAssetV1("d1", "node-abc", "Node", "N-1") },
            new[] { new GisImportFailureV1("d2", "P-1", "AssetCode 'P-1' already exists in GIS.") });

        var json = JsonSerializer.Serialize(payload);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        root.GetProperty("Imported")[0].GetProperty("GisAssetId").GetString().Should().Be("node-abc");
        root.GetProperty("Failed")[0].GetProperty("Reason").GetString().Should().Contain("already exists");
    }
}
```

- [ ] **Step 3: Run both contract test projects**

Run:
```bash
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj --nologo
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/WaterNetwork.Gis.ContractTests.csproj --nologo
```
Expected: PASS (both new tests green).

- [ ] **Step 4: Commit**

```bash
git add src/services/*/tests/*ContractTests
git commit -m "test(design,gis): DSN-4 publish event contract tests (DSN-4)"
```

---

## Task 4: design-be — `Published`/`PartiallyPublished` status + `MarkPublished`

**Files:**
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/ValueObjects/DesignRevisionStatus.cs`
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/Aggregates/DesignRevision.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/DomainEvents/DesignRevisionPublished.cs`
- Test: `src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DesignRevisionPublishTransitionTests.cs`

- [ ] **Step 1: Write the failing tests**

`DesignRevisionPublishTransitionTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Design.UnitTests;

public sealed class DesignRevisionPublishTransitionTests
{
    private static DesignRevision Approved()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.ApplyValidation(ValidationResult.Empty());      // → Validated
        rev.Submit("designer", "corr-1");                    // → Submitted
        rev.Approve("approver", reason: null, "corr-2");     // → Approved
        return rev;
    }

    [Fact]
    public void MarkPublished_all_imported_sets_Published()
    {
        var rev = Approved();
        rev.MarkPublished(importedCount: 3, failedCount: 0, "importer", "corr-3");
        rev.Status.Should().Be(DesignRevisionStatus.Published);
        rev.DomainEvents.Should().ContainSingle(e => e is DesignRevisionPublished);
    }

    [Fact]
    public void MarkPublished_with_failures_sets_PartiallyPublished()
    {
        var rev = Approved();
        rev.MarkPublished(importedCount: 2, failedCount: 1, "importer", "corr-3");
        rev.Status.Should().Be(DesignRevisionStatus.PartiallyPublished);
    }

    [Fact]
    public void MarkPublished_from_non_Approved_throws()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1); // Draft
        var act = () => rev.MarkPublished(1, 0, "importer", "corr-3");
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void MarkPublished_records_transition()
    {
        var rev = Approved();
        rev.MarkPublished(1, 0, "importer", "corr-3");
        rev.Transitions.Should().Contain(t =>
            t.FromStatus == DesignRevisionStatus.Approved && t.ToStatus == DesignRevisionStatus.Published);
    }
}
```
> If `ValidationResult.Empty()` does not exist, build a zero-error `ValidationResult` the same way DSN-2/3 tests do (check `DesignRevisionTransitionTests.cs` for the exact constructor).

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --nologo`
Expected: FAIL — `Published`/`MarkPublished` not defined.

- [ ] **Step 3: Extend the status enum**

`DesignRevisionStatus.cs`:
```csharp
public enum DesignRevisionStatus
{
    Draft,
    Validated,
    Submitted,
    Approved,
    Published,
    PartiallyPublished
}
```

- [ ] **Step 4: Create the domain event**

`DomainEvents/DesignRevisionPublished.cs` (mirror `DesignRevisionApproved.cs`):
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignRevisionPublishedData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string Status,
    int ImportedCount,
    int FailedCount);

public sealed record DesignRevisionPublished(string AggregateId, DesignRevisionPublishedData Data)
    : DomainEventBase(AggregateId, nameof(DesignRevision));
```
> Match the exact base-class + constructor shape of `DesignRevisionApproved.cs` (open it; `DomainEventBase` signature / namespace may differ — copy it verbatim, only changing names).

- [ ] **Step 5: Add `MarkPublished` to the aggregate**

In `DesignRevision.cs`, after `Reject(...)`:
```csharp
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
            ProjectId, TenantId, RevisionNumber, target.ToString(), importedCount, failedCount)));
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --nologo`
Expected: PASS (all 4 new tests green; existing 59 still green).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Domain \
        src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DesignRevisionPublishTransitionTests.cs
git commit -m "feat(design): DSN-4 Published/PartiallyPublished status + MarkPublished (DSN-4)"
```

---

## Task 5: design-be — `BeginPublish` + `DesignAssetReadyForGis` domain event + draft snapshot

**Files:**
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/ValueObjects/DraftAssetSnapshot.cs`
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/DomainEvents/DesignAssetReadyForGis.cs`
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Domain/Aggregates/DesignRevision.cs`
- Test: append to `DesignRevisionPublishTransitionTests.cs`

- [ ] **Step 1: Write the failing test (append)**

```csharp
    [Fact]
    public void BeginPublish_from_Approved_raises_ReadyForGis_without_status_change()
    {
        var rev = Approved();
        var drafts = new[]
        {
            new DraftAssetSnapshot("d1", "Node", "N-1", "cr-1",
                new DraftGeometrySnapshot("Point", new[] { new[] { 106.7, 10.8 } }),
                new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null)
        };

        rev.BeginPublish(drafts, approvedBy: "approver");

        rev.Status.Should().Be(DesignRevisionStatus.Approved); // unchanged until completion
        var evt = rev.DomainEvents.OfType<DesignAssetReadyForGis>().Single();
        evt.Data.Assets.Should().ContainSingle(a => a.AssetCode == "N-1");
        evt.Data.ApprovedBy.Should().Be("approver");
    }

    [Fact]
    public void BeginPublish_from_non_Approved_throws()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        var act = () => rev.BeginPublish(Array.Empty<DraftAssetSnapshot>(), "approver");
        act.Should().Throw<BusinessRuleException>();
    }
```
Add `using WaterNetwork.Design.Domain.ValueObjects;` if missing.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --nologo`
Expected: FAIL — `DraftAssetSnapshot`/`BeginPublish`/`DesignAssetReadyForGis` not defined.

- [ ] **Step 3: Create the snapshot value objects**

`ValueObjects/DraftAssetSnapshot.cs`:
```csharp
namespace WaterNetwork.Design.Domain.ValueObjects;

/// <summary>Immutable view of a draft asset handed to <c>DesignRevision.BeginPublish</c> to build the
/// ready-for-gis event payload. Geometry coordinates are GeoJSON [lng, lat].</summary>
public sealed record DraftAssetSnapshot(
    string DraftAssetId,
    string Kind,
    string AssetCode,
    string? ClientRef,
    DraftGeometrySnapshot Geometry,
    IReadOnlyDictionary<string, string> Attributes,
    string? FromRef,
    string? ToRef,
    string? HostRef);

public sealed record DraftGeometrySnapshot(
    string Type,
    IReadOnlyList<IReadOnlyList<double>> Coordinates);
```

- [ ] **Step 4: Create the domain event**

`DomainEvents/DesignAssetReadyForGis.cs`:
```csharp
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignAssetReadyForGisData(
    string ProjectId,
    string TenantId,
    int RevisionNumber,
    string ApprovedBy,
    IReadOnlyList<DraftAssetSnapshot> Assets);

public sealed record DesignAssetReadyForGis(string AggregateId, DesignAssetReadyForGisData Data)
    : DomainEventBase(AggregateId, nameof(DesignRevision));
```

- [ ] **Step 5: Add `BeginPublish` to the aggregate**

In `DesignRevision.cs`:
```csharp
    /// <summary>Emits the batch ready-for-gis event. Status stays Approved until GIS reports completion
    /// (see MarkPublished). Idempotency on re-trigger is provided by the inbox dedup of the approved event.</summary>
    public void BeginPublish(IReadOnlyList<DraftAssetSnapshot> drafts, string approvedBy)
    {
        if (Status != DesignRevisionStatus.Approved)
            throw BusinessRuleException.Violation("InvalidRevisionTransition",
                $"[InvalidRevisionTransition] Cannot publish a revision in status {Status}; it must be Approved.");

        MarkAsModified();
        AddDomainEvent(new DesignAssetReadyForGis(Id, new DesignAssetReadyForGisData(
            ProjectId, TenantId, RevisionNumber, approvedBy, drafts)));
    }
```
Add `using WaterNetwork.Design.Domain.ValueObjects;` at the top if not present.

- [ ] **Step 6: Run the tests**

Run: `dotnet test .../WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --nologo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Domain \
        src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DesignRevisionPublishTransitionTests.cs
git commit -m "feat(design): DSN-4 BeginPublish + DesignAssetReadyForGis domain event (DSN-4)"
```

---

## Task 6: design-be — map 2 new domain events in the outbox mapper

**Files:**
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/IntegrationEvents/DesignIntegrationEventMapper.cs`
- Test: `src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/DesignIntegrationEventMapperTests.cs` (create or append if exists)

- [ ] **Step 1: Write the failing mapper test**

```csharp
using FluentAssertions;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.IntegrationEvents;
using Xunit;

namespace WaterNetwork.Design.UnitTests;

public sealed class DesignPublishMapperTests
{
    private readonly DesignIntegrationEventMapper _mapper = new();

    [Fact]
    public void Maps_DesignAssetReadyForGis_to_integration_event()
    {
        var evt = new DesignAssetReadyForGis("rev-1", new DesignAssetReadyForGisData(
            "proj-1", "tenant-1", 1, "approver",
            new[] { new DraftAssetSnapshot("d1", "Node", "N-1", null,
                new DraftGeometrySnapshot("Point", new[] { new[] { 106.7, 10.8 } }),
                new Dictionary<string, string>(), null, null, null) }));

        _mapper.CanMap(nameof(DesignAssetReadyForGis)).Should().BeTrue();
        var ie = _mapper.Map(evt);
        ie!.EventType.Should().Be(DesignEventTypes.AssetReadyForGis);
    }

    [Fact]
    public void Maps_DesignRevisionPublished_to_integration_event()
    {
        var evt = new DesignRevisionPublished("rev-1",
            new DesignRevisionPublishedData("proj-1", "tenant-1", 1, "Published", 2, 0));
        _mapper.Map(evt)!.EventType.Should().Be(DesignEventTypes.RevisionPublished);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --nologo`
Expected: FAIL — `CanMap` returns false / `Map` returns null.

- [ ] **Step 3: Extend the mapper registry + add map methods**

In `DesignIntegrationEventMapper.cs`, add to the `Registry` dictionary:
```csharp
            ["DesignAssetReadyForGis"] = e => e is DesignAssetReadyForGis x ? MapReadyForGis(x) : null,
            ["DesignRevisionPublished"] = e => e is DesignRevisionPublished x ? MapRevisionPublished(x) : null,
```
Add the two integration-event records near the existing ones (mirror `DesignRevisionApprovedIntegrationEvent` positional shape):
```csharp
public sealed record DesignAssetReadyForGisIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignAssetReadyForGisV1 Data) : IIntegrationEvent;

public sealed record DesignRevisionPublishedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionPublishedV1 Data) : IIntegrationEvent;
```
> Copy the exact interface name and member set from `DesignRevisionApprovedIntegrationEvent` — if it implements a base/`IIntegrationEvent` differently, match it verbatim.

Add the map methods. Use **named arguments** for the V1 payloads (the V1 first field is `RevisionId`, sourced from `e.AggregateId` — not from `e.Data`). Coordinates pass through unchanged (payload stays GeoJSON [lng,lat]):
```csharp
    private static DesignAssetReadyForGisIntegrationEvent MapReadyForGis(DesignAssetReadyForGis e)
        => new(e.EventId, DesignEventTypes.AssetReadyForGis, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignAssetReadyForGisV1(
                RevisionId: e.AggregateId,
                ProjectId: e.Data.ProjectId,
                TenantId: e.Data.TenantId,
                RevisionNumber: e.Data.RevisionNumber,
                ApprovedBy: e.Data.ApprovedBy,
                Assets: e.Data.Assets.Select(a => new ReadyForGisAssetV1(
                    a.DraftAssetId, a.Kind, a.AssetCode, a.ClientRef,
                    new ReadyForGisGeometryV1(a.Geometry.Type, a.Geometry.Coordinates),
                    a.Attributes, a.FromRef, a.ToRef, a.HostRef)).ToList()));

    private static DesignRevisionPublishedIntegrationEvent MapRevisionPublished(DesignRevisionPublished e)
        => new(e.EventId, DesignEventTypes.RevisionPublished, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionPublishedV1(
                RevisionId: e.AggregateId,
                ProjectId: e.Data.ProjectId,
                TenantId: e.Data.TenantId,
                RevisionNumber: e.Data.RevisionNumber,
                Status: e.Data.Status,
                ImportedCount: e.Data.ImportedCount,
                FailedCount: e.Data.FailedCount));
```

- [ ] **Step 4: Run the tests**

Run: `dotnet test .../WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj --nologo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/IntegrationEvents \
        src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests
git commit -m "feat(design): DSN-4 map ready-for-gis + revision-published to outbox (DSN-4)"
```

---

## Task 7: design-be — `RevisionApprovedPublishConsumer` (trigger)

**Files:**
- Create: `src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Consumers/RevisionApprovedPublishConsumer.cs`
- Modify: `src/services/water-network-design-be/src/WaterNetwork.Design.Api/Program.cs`
- Test: `src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/RevisionPublishFlowTests.cs`

**Behavior:** subscribe `design.revision.approved` → load revision (must be `Approved`) + its drafts → build `DraftAssetSnapshot[]` → `rev.BeginPublish(snapshots, approvedBy)` → `revisionRepository.SaveAsync(rev)` (flushes the ready-for-gis domain event to the outbox). Idempotency: `IdempotentEnvelopeConsumer` dedups by `EventId`.

- [ ] **Step 1: Write the failing integration test**

```csharp
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Infrastructure.Consumers;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using Xunit;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgres")]   // reuse the existing fixture collection name in this project
public sealed class RevisionPublishFlowTests
{
    private readonly DesignPostgresFixture _pg;   // match the existing fixture type name
    public RevisionPublishFlowTests(DesignPostgresFixture pg) => _pg = pg;

    [Fact]
    public async Task Approved_event_triggers_ready_for_gis_in_outbox()
    {
        await using var factory = new DesignApiFactory(_pg);
        using var scope = factory.Services.CreateScope();
        var sp = scope.ServiceProvider;
        await MigrateAndSeedApprovedRevisionWithDrafts(sp, revisionId: "rev-pub-1", tenantId: "tenant-1");

        var consumer = ActivatorUtilities.CreateInstance<RevisionApprovedPublishConsumer>(sp);
        var approvedPayload = JsonSerializer.Serialize(new
        {
            Data = new DesignRevisionApprovedV1("rev-pub-1", "proj-1", "tenant-1", 1, "approver", null)
        });
        var envelope = new IntegrationEventEnvelope(
            EventId: "evt-approved-1", EventType: DesignEventTypes.RevisionApproved, EventVersion: 1,
            OccurredAt: DateTime.UtcNow, TenantId: "tenant-1", OrganizationId: null, BranchId: null,
            CorrelationId: "corr-1", CausationId: null, Producer: "design-be", Payload: approvedPayload);

        await consumer.HandleEnvelopeAsync(envelope, CancellationToken.None);

        var outbox = sp.GetRequiredService<IOutboxRepository>();
        var pending = await outbox.GetPendingAsync(50, CancellationToken.None);
        pending.Should().Contain(e => e.EventType == DesignEventTypes.AssetReadyForGis);

        // Idempotent: second delivery does not add another ready-for-gis row.
        await consumer.HandleEnvelopeAsync(envelope, CancellationToken.None);
        var after = await outbox.GetPendingAsync(50, CancellationToken.None);
        after.Count(e => e.EventType == DesignEventTypes.AssetReadyForGis).Should().Be(1);
    }
}
```
> The exact fixture/factory type names (`DesignPostgresFixture`, `DesignApiFactory`, collection name) and `IOutboxRepository.GetPendingAsync` signature must be copied from existing integration tests in this project (open `DesignRevisionApprovalApiTests.cs` and any outbox assertion test). Implement `MigrateAndSeedApprovedRevisionWithDrafts` as a local helper that: migrates, inserts a project, a revision in `Approved` status (with the transition chain or by directly persisting an Approved row), and 1–2 drafts via `IDraftNetworkAssetRepository`.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj --filter RevisionPublishFlowTests --nologo`
Expected: FAIL — `RevisionApprovedPublishConsumer` does not exist.

- [ ] **Step 3: Implement the consumer**

`Consumers/RevisionApprovedPublishConsumer.cs`:
```csharp
using System.Text.Json;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Design.Infrastructure.Consumers;

/// <summary>
/// Reacts to design.revision.approved (the service's own event) and emits the ready-for-gis batch.
/// First consumer of water-network-design-be. Status stays Approved until GIS reports completion.
/// </summary>
public sealed class RevisionApprovedPublishConsumer(
    IDesignRevisionRepository revisionRepository,
    IDraftNetworkAssetRepository draftRepository,
    IInboxMessageStore inboxMessageStore)
    : IdempotentEnvelopeConsumer(inboxMessageStore)
{
    protected override string ConsumerName => "design.revision-approved-publish";

    protected override bool Subscribes(string eventType) => eventType == DesignEventTypes.RevisionApproved;

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var data = doc.RootElement.GetProperty("Data").Deserialize<DesignRevisionApprovedV1>()
            ?? throw new InvalidOperationException("approved payload Data did not deserialize.");

        var revision = await revisionRepository.GetByIdAsync(data.RevisionId, ct);
        if (revision is null || revision.Status != DesignRevisionStatus.Approved)
            return; // nothing to publish (already moved on, or unknown)

        var drafts = await draftRepository.ListByRevisionAsync(data.TenantId, data.RevisionId, ct);
        var snapshots = drafts.Select(ToSnapshot).ToList();

        revision.BeginPublish(snapshots, approvedBy: data.ActorId);
        await revisionRepository.SaveAsync(revision, ct);
    }

    private static DraftAssetSnapshot ToSnapshot(Domain.Entities.DraftNetworkAsset d)
        => new(
            d.Id, d.Kind.ToString(), d.AssetCode, d.ClientRef,
            new DraftGeometrySnapshot(
                d.Geometry.Type.ToString(),
                d.Geometry.Coordinates.Select(c => (IReadOnlyList<double>)new[] { c.X, c.Y }).ToList()),
            d.Attributes, d.FromRef, d.ToRef, d.HostRef);
}
```
> Confirm `DraftGeometry.Type` is `DraftGeometryType` (`Point`/`LineString`) and `Coordinates` items are `GeoCoordinate(X, Y)` — both confirmed in `DraftNetworkAssetRepository.cs`. `ListByRevisionAsync(tenantId, revisionId, ct)` signature confirmed.

- [ ] **Step 4: Register the consumer in `Program.cs`**

In `WaterNetwork.Design.Api/Program.cs`, replace the bare event-bus line:
```csharp
builder.Services.AddPlatformEventBus(builder.Configuration);
```
with:
```csharp
builder.Services.AddScoped<RevisionApprovedPublishConsumer>();
builder.Services.AddScoped<GisImportCompletedConsumer>();   // added in Task 9
builder.Services.AddPlatformEventBus(builder.Configuration, bus =>
{
    bus.AddConsumer<RevisionApprovedPublishConsumer>();
    bus.AddConsumer<GisImportCompletedConsumer>();           // added in Task 9
});
```
Add `using WaterNetwork.Design.Infrastructure.Consumers;`.
> If executing Task 7 before Task 9, comment out the `GisImportCompletedConsumer` lines and re-enable them in Task 9 so the project compiles between tasks.

- [ ] **Step 5: Run the test**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj --filter RevisionPublishFlowTests --nologo`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Consumers/RevisionApprovedPublishConsumer.cs \
        src/services/water-network-design-be/src/WaterNetwork.Design.Api/Program.cs \
        src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/RevisionPublishFlowTests.cs
git commit -m "feat(design): DSN-4 RevisionApprovedPublishConsumer emits ready-for-gis (DSN-4)"
```

---

## Task 8: gis-be — `gis_import_ledger` table + store

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Persistence/GisImportLedgerPersistenceModel.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Persistence/Configurations/GisImportLedgerConfiguration.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IGisImportLedgerStore.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/GisImportLedgerStore.cs`
- Migration: generated under `WaterNetwork.Gis.Infrastructure/Persistence/Migrations/`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GisImportLedgerStoreTests.cs`

- [ ] **Step 1: Write the failing repo test**

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Ports;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public sealed class GisImportLedgerStoreTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private readonly PostgisFixture _postgis = postgis;

    [Fact]
    public async Task Record_then_Lookup_roundtrips_and_is_idempotent()
    {
        await using var factory = new GisApiFactory(_postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);
        var store = scope.ServiceProvider.GetRequiredService<IGisImportLedgerStore>();

        (await store.GetExistingAsync("rev-1", "d1", default)).Should().BeNull();

        await store.RecordAsync("tenant-1", "rev-1", "d1", "node-x", "Node", "N-1", default);
        (await store.GetExistingAsync("rev-1", "d1", default)).Should().Be("node-x");

        // Re-record same (revision, draft) is a no-op (idempotent), not a crash.
        await store.RecordAsync("tenant-1", "rev-1", "d1", "node-x", "Node", "N-1", default);
        (await store.GetExistingAsync("rev-1", "d1", default)).Should().Be("node-x");
    }
}
```
> Copy the exact fixture names (`PostgisFixture`, `GisApiFactory`, `MigrateAsync` helper) from an existing GIS integration test (e.g. `NetworkDeviceRepositoryTests.cs`).

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter GisImportLedgerStoreTests --nologo`
Expected: FAIL — `IGisImportLedgerStore` does not exist.

- [ ] **Step 3: Create the persistence model**

`Persistence/GisImportLedgerPersistenceModel.cs`:
```csharp
namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class GisImportLedgerPersistenceModel
{
    public string Id { get; set; } = default!;          // surrogate (Guid v7)
    public string TenantId { get; set; } = default!;
    public string RevisionId { get; set; } = default!;
    public string DraftAssetId { get; set; } = default!;
    public string GisAssetId { get; set; } = default!;
    public string Kind { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
}
```

- [ ] **Step 4: Create the EF configuration**

`Persistence/Configurations/GisImportLedgerConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class GisImportLedgerConfiguration : IEntityTypeConfiguration<GisImportLedgerPersistenceModel>
{
    public void Configure(EntityTypeBuilder<GisImportLedgerPersistenceModel> builder)
    {
        builder.ToTable("gis_import_ledger");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.RevisionId).HasColumnName("revision_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DraftAssetId).HasColumnName("draft_asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.GisAssetId).HasColumnName("gis_asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Kind).HasColumnName("kind").HasMaxLength(16).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");

        builder.HasIndex(x => new { x.RevisionId, x.DraftAssetId })
            .IsUnique().HasDatabaseName("ux_gis_import_ledger_revision_draft");
    }
}
```
> The config is auto-discovered: `GisDbContext` must use `ApplyConfigurationsFromAssembly` (confirm — gis configs are picked up that way). If `GisDbContext` registers configs explicitly, add `new GisImportLedgerConfiguration().Configure(...)` / `modelBuilder.ApplyConfiguration(new GisImportLedgerConfiguration())` following the existing pattern, plus a `DbSet` if other entities have one.

- [ ] **Step 5: Create the port + store**

`Application/Ports/IGisImportLedgerStore.cs`:
```csharp
namespace WaterNetwork.Gis.Application.Ports;

public interface IGisImportLedgerStore
{
    Task<string?> GetExistingAsync(string revisionId, string draftAssetId, CancellationToken ct);
    Task RecordAsync(string tenantId, string revisionId, string draftAssetId,
        string gisAssetId, string kind, string assetCode, CancellationToken ct);
}
```

`Infrastructure/Repositories/GisImportLedgerStore.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Common;   // PostgresExceptionHelper
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class GisImportLedgerStore(GisDbContext dbContext) : IGisImportLedgerStore
{
    public async Task<string?> GetExistingAsync(string revisionId, string draftAssetId, CancellationToken ct)
        => await dbContext.Set<GisImportLedgerPersistenceModel>().AsNoTracking()
            .Where(x => x.RevisionId == revisionId && x.DraftAssetId == draftAssetId)
            .Select(x => x.GisAssetId)
            .FirstOrDefaultAsync(ct);

    public async Task RecordAsync(string tenantId, string revisionId, string draftAssetId,
        string gisAssetId, string kind, string assetCode, CancellationToken ct)
    {
        dbContext.Set<GisImportLedgerPersistenceModel>().Add(new GisImportLedgerPersistenceModel
        {
            Id = Guid.CreateVersion7().ToString(),
            TenantId = tenantId, RevisionId = revisionId, DraftAssetId = draftAssetId,
            GisAssetId = gisAssetId, Kind = kind, AssetCode = assetCode, CreatedAt = DateTime.UtcNow
        });
        try
        {
            await dbContext.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            // Concurrent redelivery already recorded this (revision, draft) — idempotent no-op.
            dbContext.ChangeTracker.Clear();
        }
    }
}
```

- [ ] **Step 6: Register the store in `Program.cs`**

Add to `WaterNetwork.Gis.Api/Program.cs` (with the other `AddScoped` ports):
```csharp
builder.Services.AddScoped<IGisImportLedgerStore, GisImportLedgerStore>();
```

- [ ] **Step 7: Generate the migration**

Run (from repo root; matches the project's existing EF setup — NEVER target a `.slnx`):
```bash
dotnet ef migrations add AddGisImportLedger \
  --project src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/WaterNetwork.Gis.Infrastructure.csproj \
  --startup-project src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/WaterNetwork.Gis.Api.csproj \
  --output-dir Persistence/Migrations
```
Expected: a new `<ts>_AddGisImportLedger.cs` creating `gis_import_ledger` + unique index.

- [ ] **Step 8: Verify the migration body**

Open the generated migration; confirm `CreateTable("gis_import_ledger", ...)` with the 8 columns and `CreateIndex(..., unique: true)` on `(revision_id, draft_asset_id)`. No unrelated table churn.

- [ ] **Step 9: Run the test**

Run: `dotnet test .../WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter GisImportLedgerStoreTests --nologo`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Persistence \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IGisImportLedgerStore.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/GisImportLedgerStore.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GisImportLedgerStoreTests.cs
git commit -m "feat(gis): DSN-4 gis_import_ledger table + store (DSN-4)"
```

---

## Task 9: gis-be — `DraftAssetMapper` (attribute → factory args)

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Consumers/DraftAssetMapper.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/DraftAssetMapperTests.cs`

Pure functions mapping a `ReadyForGisAssetV1` + a `clientRef→gisId` map into domain objects. No I/O — fully unit-testable. Throws `DraftMappingException` (a local exception type) for bad attributes/refs so the consumer can record a `failed[]` entry.

- [ ] **Step 1: Write the failing tests**

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterNetwork.Gis.Domain.ValueObjects;
using Xunit;

namespace WaterNetwork.Gis.UnitTests;

public sealed class DraftAssetMapperTests
{
    private static ReadyForGisAssetV1 Node() => new(
        "d1", "Node", "N-1", "cr-node",
        new ReadyForGisGeometryV1("Point", new[] { new double[] { 106.7, 10.8 } }),
        new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null);

    [Fact]
    public void Maps_node_with_correct_coordinate_order()
    {
        var (geoPoint, nodeType) = DraftAssetMapper.MapNode(Node());
        geoPoint.Latitude.Should().Be(10.8);     // Y
        geoPoint.Longitude.Should().Be(106.7);   // X
        nodeType.Should().Be(NodeType.Junction);
    }

    [Fact]
    public void Node_missing_nodeType_throws_DraftMappingException()
    {
        var bad = Node() with { Attributes = new Dictionary<string, string>() };
        var act = () => DraftAssetMapper.MapNode(bad);
        act.Should().Throw<DraftMappingException>().WithMessage("*nodeType*");
    }

    [Fact]
    public void Maps_pipe_resolving_endpoints_from_clientRef_map()
    {
        var pipe = new ReadyForGisAssetV1("d3", "Pipe", "P-1", "cr-pipe",
            new ReadyForGisGeometryV1("LineString", new[]
            {
                new double[] { 106.7, 10.8 }, new double[] { 106.71, 10.81 }
            }),
            new Dictionary<string, string> { ["diameterMm"] = "110", ["material"] = "PVC" },
            FromRef: "cr-a", ToRef: "cr-b", HostRef: null);

        var map = new Dictionary<string, string> { ["cr-a"] = "node-a", ["cr-b"] = "node-b" };
        var m = DraftAssetMapper.MapPipe(pipe, map);
        m.FromNodeId.Should().Be("node-a");
        m.ToNodeId.Should().Be("node-b");
        m.Points.Should().HaveCount(2);
        m.Points[0].Latitude.Should().Be(10.8);
        m.DiameterMm.Should().Be(110);
        m.Material.Should().Be("PVC");
        m.LengthM.Should().BeNull();   // not supplied → GIS computes
    }

    [Fact]
    public void Pipe_unresolved_endpoint_throws()
    {
        var pipe = new ReadyForGisAssetV1("d3", "Pipe", "P-1", null,
            new ReadyForGisGeometryV1("LineString", new[] { new double[] { 1, 2 }, new double[] { 3, 4 } }),
            new Dictionary<string, string> { ["diameterMm"] = "110", ["material"] = "PVC" },
            "cr-missing", "cr-b", null);
        var act = () => DraftAssetMapper.MapPipe(pipe, new Dictionary<string, string> { ["cr-b"] = "node-b" });
        act.Should().Throw<DraftMappingException>().WithMessage("*cr-missing*");
    }

    [Fact]
    public void Maps_device_resolving_host_pipe()
    {
        var device = new ReadyForGisAssetV1("d4", "Device", "V-1", "cr-dev",
            new ReadyForGisGeometryV1("Point", new[] { new double[] { 106.7, 10.8 } }),
            new Dictionary<string, string> { ["deviceType"] = "Valve" },
            null, null, HostRef: "cr-pipe");
        var map = new Dictionary<string, string> { ["cr-pipe"] = "pipe-1" };
        var m = DraftAssetMapper.MapDevice(device, map);
        m.DeviceType.Should().Be("Valve");
        m.HostPipeOrNodeId.Should().Be("pipe-1");
        m.Location.Latitude.Should().Be(10.8);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj --filter DraftAssetMapperTests --nologo`
Expected: FAIL — `DraftAssetMapper`/`DraftMappingException` not defined.

- [ ] **Step 3: Implement the mapper + exception + result records**

`Consumers/DraftAssetMapper.cs`:
```csharp
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.ValueObjects;

namespace WaterNetwork.Gis.Infrastructure.Consumers;

/// <summary>Thrown when a draft cannot be mapped to GIS factory args (bad attribute, unresolved ref).
/// The import consumer catches it and records a failed[] entry — it never aborts the batch.</summary>
public sealed class DraftMappingException(string message) : Exception(message);

public sealed record PipeImportArgs(
    string FromNodeId, string ToNodeId, IReadOnlyList<GeoPoint> Points,
    int DiameterMm, string Material, double? LengthM);

public sealed record DeviceImportArgs(
    string DeviceType, string HostPipeOrNodeId, GeoPoint Location);

public static class DraftAssetMapper
{
    public static (GeoPoint Point, NodeType NodeType) MapNode(ReadyForGisAssetV1 a)
    {
        var point = SinglePoint(a);
        var nodeTypeRaw = Require(a, "nodeType");
        if (!Enum.TryParse<NodeType>(nodeTypeRaw, ignoreCase: true, out var nodeType) || !Enum.IsDefined(nodeType))
            throw new DraftMappingException($"Draft '{a.AssetCode}': invalid nodeType '{nodeTypeRaw}'.");
        return (point, nodeType);
    }

    public static PipeImportArgs MapPipe(ReadyForGisAssetV1 a, IReadOnlyDictionary<string, string> clientRefToGisId)
    {
        if (a.Geometry.Type != "LineString" || a.Geometry.Coordinates.Count < 2)
            throw new DraftMappingException($"Draft '{a.AssetCode}': pipe needs a LineString with >= 2 points.");
        var from = ResolveRef(a, a.FromRef, "fromRef", clientRefToGisId);
        var to = ResolveRef(a, a.ToRef, "toRef", clientRefToGisId);
        var diameterRaw = Require(a, "diameterMm");
        if (!int.TryParse(diameterRaw, out var diameter) || diameter <= 0)
            throw new DraftMappingException($"Draft '{a.AssetCode}': invalid diameterMm '{diameterRaw}'.");
        var material = Require(a, "material");
        double? lengthM = a.Attributes.TryGetValue("lengthM", out var lr) && double.TryParse(lr, out var l) ? l : null;
        var points = a.Geometry.Coordinates.Select(ToGeoPoint).ToList();
        return new PipeImportArgs(from, to, points, diameter, material, lengthM);
    }

    public static DeviceImportArgs MapDevice(ReadyForGisAssetV1 a, IReadOnlyDictionary<string, string> clientRefToGisId)
    {
        var location = SinglePoint(a);
        var deviceType = Require(a, "deviceType");
        var hostId = ResolveRef(a, a.HostRef, "hostRef", clientRefToGisId);
        return new DeviceImportArgs(deviceType, hostId, location);
    }

    private static GeoPoint SinglePoint(ReadyForGisAssetV1 a)
    {
        if (a.Geometry.Type != "Point" || a.Geometry.Coordinates.Count != 1)
            throw new DraftMappingException($"Draft '{a.AssetCode}': expected a single Point geometry.");
        return ToGeoPoint(a.Geometry.Coordinates[0]);
    }

    // GeoJSON [lng, lat] → GeoPoint(latitude, longitude)
    private static GeoPoint ToGeoPoint(IReadOnlyList<double> c) => new(c[1], c[0]);

    private static string Require(ReadyForGisAssetV1 a, string key)
        => a.Attributes.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v)
            ? v
            : throw new DraftMappingException($"Draft '{a.AssetCode}': missing required attribute '{key}'.");

    private static string ResolveRef(ReadyForGisAssetV1 a, string? @ref, string field,
        IReadOnlyDictionary<string, string> map)
    {
        if (string.IsNullOrWhiteSpace(@ref))
            throw new DraftMappingException($"Draft '{a.AssetCode}': {field} is required.");
        return map.TryGetValue(@ref, out var gisId)
            ? gisId
            : throw new DraftMappingException($"Draft '{a.AssetCode}': {field} '{@ref}' did not resolve to an imported asset in this batch.");
    }
}
```
> Confirm `GeoPoint` ctor is `(double latitude, double longitude)` and `NodeType` enum members (`Junction`,`Reservoir`,`Tank`,`Hydrant`,`Other`) — both confirmed from GIS validators/handlers. `DeviceHost.For(deviceType, hostPipeId, hostNodeId)` is applied in the consumer (Task 10), not here — `MapDevice` returns a single `HostPipeOrNodeId` and the consumer decides pipe-vs-node host slot based on `DeviceType` via `DeviceHost.For`.

- [ ] **Step 4: Run the tests**

Run: `dotnet test .../WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj --filter DraftAssetMapperTests --nologo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Consumers/DraftAssetMapper.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/DraftAssetMapperTests.cs
git commit -m "feat(gis): DSN-4 DraftAssetMapper attribute→factory mapping (DSN-4)"
```

---

## Task 10: gis-be — `NetworkGisImportCompleted` domain event + `GisImportBatch` aggregate + mapper

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/DomainEvents/NetworkGisImportCompleted.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Aggregates/GisImportBatch.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/GisImportCompletedMapperTests.cs`

The completion event must reach the bus via the outbox, which requires a domain event raised on an aggregate that the repo saves. `GisImportBatch` is a transient aggregate (not persisted as a table) used only to carry the domain event into the outbox — mirror how other GIS aggregates raise events, but persist ONLY its domain events. (Simplest viable approach; see Task 11 for how the consumer flushes it.)

- [ ] **Step 1: Write the failing mapper test**

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Contracts;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using Xunit;

namespace WaterNetwork.Gis.UnitTests;

public sealed class GisImportCompletedMapperTests
{
    [Fact]
    public void Maps_NetworkGisImportCompleted_to_integration_event()
    {
        var evt = new NetworkGisImportCompleted("rev-1", new NetworkGisImportCompletedData(
            "rev-1", "tenant-1",
            new[] { new GisImportedAsset("d1", "node-x", "Node", "N-1") },
            new[] { new GisImportFailure("d2", "P-1", "duplicate") }));

        var mapper = new GisIntegrationEventMapper();
        mapper.CanMap(nameof(NetworkGisImportCompleted)).Should().BeTrue();
        var ie = mapper.Map(evt);
        ie!.EventType.Should().Be(GisEventTypes.GisImportCompleted);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj --filter GisImportCompletedMapperTests --nologo`
Expected: FAIL.

- [ ] **Step 3: Create the domain event**

`Domain/DomainEvents/NetworkGisImportCompleted.cs` (mirror `NodeRegistered.cs` base/ctor shape):
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record GisImportedAsset(string DraftAssetId, string GisAssetId, string Kind, string AssetCode);
public sealed record GisImportFailure(string DraftAssetId, string AssetCode, string Reason);

public sealed record NetworkGisImportCompletedData(
    string RevisionId,
    string TenantId,
    IReadOnlyList<GisImportedAsset> Imported,
    IReadOnlyList<GisImportFailure> Failed);

public sealed record NetworkGisImportCompleted(string AggregateId, NetworkGisImportCompletedData Data)
    : DomainEventBase(AggregateId, nameof(GisImportBatch));
```

- [ ] **Step 4: Create the carrier aggregate**

`Domain/Aggregates/GisImportBatch.cs`:
```csharp
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Gis.Domain.Aggregates;

/// <summary>Transient aggregate whose only job is to carry the import-completed domain event into the
/// outbox. Not persisted to a table of its own — the import consumer enqueues its domain events only.</summary>
public sealed class GisImportBatch : AggregateRoot
{
    private GisImportBatch(string id) : base(id) { }

    public static GisImportBatch Completed(
        string revisionId, string tenantId,
        IReadOnlyList<GisImportedAsset> imported, IReadOnlyList<GisImportFailure> failed)
    {
        var batch = new GisImportBatch(revisionId);
        batch.AddDomainEvent(new NetworkGisImportCompleted(revisionId,
            new NetworkGisImportCompletedData(revisionId, tenantId, imported, failed)));
        return batch;
    }
}
```
> Confirm `AggregateRoot` has a single-arg `(string id)` ctor (DSN-3 `DesignRevision` uses a richer base — GIS aggregates may differ). If the base requires `(id, version, createdAt, updatedAt)`, call it with `version: 0`. Match `NetworkNode`'s base call.

- [ ] **Step 5: Extend the GIS outbox mapper**

In `GisIntegrationEventMapper.cs`, add to `Registry`:
```csharp
            ["NetworkGisImportCompleted"] = e => e is NetworkGisImportCompleted x ? MapImportCompleted(x) : null,
```
Add the integration-event record + map method (mirror the existing GIS map methods' integration-event shape):
```csharp
    private static NetworkGisImportCompletedIntegrationEvent MapImportCompleted(NetworkGisImportCompleted e)
        => new(e.EventId, GisEventTypes.GisImportCompleted, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new NetworkGisImportCompletedV1(
                RevisionId: e.Data.RevisionId,
                TenantId: e.Data.TenantId,
                Imported: e.Data.Imported.Select(i => new GisImportedAssetV1(i.DraftAssetId, i.GisAssetId, i.Kind, i.AssetCode)).ToList(),
                Failed: e.Data.Failed.Select(f => new GisImportFailureV1(f.DraftAssetId, f.AssetCode, f.Reason)).ToList()));
```
Declare the integration event record near the other GIS ones (match the existing positional shape used by `MapNodeRegistered`):
```csharp
public sealed record NetworkGisImportCompletedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, NetworkGisImportCompletedV1 Data) : IIntegrationEvent;
```
Add `using WaterNetwork.Gis.Contracts;` and `using WaterNetwork.Gis.Contracts.Events;` if missing.

- [ ] **Step 6: Run the test**

Run: `dotnet test .../WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj --filter GisImportCompletedMapperTests --nologo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/GisImportCompletedMapperTests.cs
git commit -m "feat(gis): DSN-4 NetworkGisImportCompleted event + outbox mapping (DSN-4)"
```

---

## Task 11: gis-be — `DesignAssetImportConsumer` (the heart)

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Consumers/DesignAssetImportConsumer.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/DesignAssetImportConsumerTests.cs`

**Behavior:** subscribe `design.asset.ready-for-gis`; process assets in order Node→Pipe→Device; for each, check ledger (skip+reuse if present); else map via `DraftAssetMapper`, create via the domain factory + repo (tenant from payload), append geometry version for nodes, compute length for pipes; on success record ledger + add to `imported[]` + add `clientRef→gisId` to the batch map; on `DraftMappingException`/`ConflictException`/`BusinessRuleException`/`DomainException`/23505 add to `failed[]`. After the batch, save a `GisImportBatch.Completed(...)` via the aggregate repo so the completion event hits the outbox.

- [ ] **Step 1: Write the failing integration test**

```csharp
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public sealed class DesignAssetImportConsumerTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private readonly PostgisFixture _postgis = postgis;

    private static IntegrationEventEnvelope Envelope(string eventId, DesignAssetReadyForGisV1 data) => new(
        EventId: eventId, EventType: DesignEventTypes.AssetReadyForGis, EventVersion: 1,
        OccurredAt: DateTime.UtcNow, TenantId: data.TenantId, OrganizationId: null, BranchId: null,
        CorrelationId: "corr-1", CausationId: null, Producer: "design-be",
        Payload: JsonSerializer.Serialize(new { Data = data }));

    private static ReadyForGisAssetV1 Node(string code, string clientRef, double lng, double lat) => new(
        $"draft-{code}", "Node", code, clientRef,
        new ReadyForGisGeometryV1("Point", new[] { new[] { lng, lat } }),
        new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null);

    private static ReadyForGisAssetV1 Pipe(string code, string from, string to) => new(
        $"draft-{code}", "Pipe", code, $"cr-{code}",
        new ReadyForGisGeometryV1("LineString", new[] { new[] { 106.70, 10.80 }, new[] { 106.71, 10.81 } }),
        new Dictionary<string, string> { ["diameterMm"] = "110", ["material"] = "PVC" },
        FromRef: from, ToRef: to, HostRef: null);

    [Fact]
    public async Task Imports_full_batch_and_emits_completed_all_success()
    {
        await using var factory = new GisApiFactory(_postgis);
        using var scope = factory.Services.CreateScope();
        var sp = scope.ServiceProvider;
        await MigrateAsync(scope);

        var data = new DesignAssetReadyForGisV1("rev-1", "proj-1", "tenant-1", 1, "approver",
            new[]
            {
                Node("N-1", "cr-n1", 106.70, 10.80),
                Node("N-2", "cr-n2", 106.71, 10.81),
                Pipe("P-1", "cr-n1", "cr-n2")
            });

        var consumer = ActivatorUtilities.CreateInstance<DesignAssetImportConsumer>(sp);
        await consumer.HandleEnvelopeAsync(Envelope("evt-1", data), CancellationToken.None);

        var nodes = sp.GetRequiredService<INetworkNodeRepository>();
        (await nodes.ExistsByAssetCodeAsync("tenant-1", "N-1", default)).Should().BeTrue();

        var ledger = sp.GetRequiredService<IGisImportLedgerStore>();
        (await ledger.GetExistingAsync("rev-1", "draft-P-1", default)).Should().NotBeNull();

        var outbox = sp.GetRequiredService<IOutboxRepository>();
        var pending = await outbox.GetPendingAsync(100, default);
        pending.Should().Contain(e => e.EventType ==
            WaterNetwork.Gis.Contracts.GisEventTypes.GisImportCompleted);
    }

    [Fact]
    public async Task Duplicate_asset_code_goes_to_failed_not_crash()
    {
        await using var factory = new GisApiFactory(_postgis);
        using var scope = factory.Services.CreateScope();
        var sp = scope.ServiceProvider;
        await MigrateAsync(scope);

        // Pre-create N-1 so the imported draft collides.
        // (Use the node repository + NetworkNode.Register to seed, tenant "tenant-1", code "N-1".)
        await SeedNode(sp, "tenant-1", "N-1");

        var data = new DesignAssetReadyForGisV1("rev-2", "proj-1", "tenant-1", 1, "approver",
            new[] { Node("N-1", "cr-n1", 106.70, 10.80) });

        var consumer = ActivatorUtilities.CreateInstance<DesignAssetImportConsumer>(sp);
        await consumer.HandleEnvelopeAsync(Envelope("evt-2", data), CancellationToken.None);

        // The completion event must carry exactly one failure and zero imported.
        // Assert by deserializing the outbox payload for GisImportCompleted.
        var outbox = sp.GetRequiredService<IOutboxRepository>();
        var pending = await outbox.GetPendingAsync(100, default);
        var completed = pending.Single(e => e.EventType ==
            WaterNetwork.Gis.Contracts.GisEventTypes.GisImportCompleted);
        completed.Payload.Should().Contain("\"Failed\"");
        // (Optional finer assertion: parse the payload and assert Failed.Count == 1, Imported.Count == 0.)
    }

    [Fact]
    public async Task Redelivery_does_not_create_duplicate_assets()
    {
        await using var factory = new GisApiFactory(_postgis);
        using var scope = factory.Services.CreateScope();
        var sp = scope.ServiceProvider;
        await MigrateAsync(scope);
        var data = new DesignAssetReadyForGisV1("rev-3", "proj-1", "tenant-1", 1, "approver",
            new[] { Node("N-9", "cr-n9", 106.70, 10.80) });

        var consumer = ActivatorUtilities.CreateInstance<DesignAssetImportConsumer>(sp);
        await consumer.HandleEnvelopeAsync(Envelope("evt-3", data), CancellationToken.None);
        // Re-run with the SAME revision but different EventId (inbox would dedup same EventId;
        // here we prove ledger-level idempotency by re-invoking HandleAsync directly is overkill —
        // instead assert a second HandleEnvelopeAsync with a NEW EventId still creates no duplicate).
        await consumer.HandleEnvelopeAsync(Envelope("evt-3b", data), CancellationToken.None);

        var ledger = sp.GetRequiredService<IGisImportLedgerStore>();
        var nodes = sp.GetRequiredService<INetworkNodeRepository>();
        (await nodes.ExistsByAssetCodeAsync("tenant-1", "N-9", default)).Should().BeTrue();
        // Only one ledger row for (rev-3, draft-N-9) — second pass skipped via ledger.
        (await ledger.GetExistingAsync("rev-3", "draft-N-9", default)).Should().NotBeNull();
    }
}
```
> Implement `MigrateAsync`, `GisApiFactory`, `PostgisFixture`, `SeedNode` consistent with existing GIS integration tests. For the redelivery test, the key invariant: re-processing the same `(revisionId, draftAssetId)` hits the ledger and skips creation (no second node row, no unique violation surfaced as failure on the happy path).

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter DesignAssetImportConsumerTests --nologo`
Expected: FAIL — `DesignAssetImportConsumer` does not exist.

- [ ] **Step 3: Implement the consumer**

`Consumers/DesignAssetImportConsumer.cs`:
```csharp
using System.Text.Json;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Application.Common;        // PostgresExceptionHelper
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Gis.Infrastructure.Consumers;

/// <summary>
/// Imports a ready-for-gis batch into the GIS write model via the domain factories, deduplicating per
/// (revisionId, draftAssetId) through the import ledger, then emits network.gis-import.completed.
/// </summary>
public sealed class DesignAssetImportConsumer(
    INetworkNodeRepository nodeRepository,
    INetworkPipeRepository pipeRepository,
    INetworkDeviceRepository deviceRepository,
    IGeometryVersionStore geometryVersionStore,
    IPipeLengthCalculator lengthCalculator,
    IGisImportLedgerStore ledger,
    IGisImportBatchRepository batchRepository,    // see Step 4
    IInboxMessageStore inboxMessageStore)
    : IdempotentEnvelopeConsumer(inboxMessageStore)
{
    protected override string ConsumerName => "gis.design-asset-import";

    protected override bool Subscribes(string eventType) => eventType == DesignEventTypes.AssetReadyForGis;

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var batch = doc.RootElement.GetProperty("Data").Deserialize<DesignAssetReadyForGisV1>()
            ?? throw new InvalidOperationException("ready-for-gis payload Data did not deserialize.");

        var imported = new List<GisImportedAsset>();
        var failed = new List<GisImportFailure>();
        var clientRefToGisId = new Dictionary<string, string>(StringComparer.Ordinal);

        // Node → Pipe → Device. Within each kind, preserve payload order.
        foreach (var a in Ordered(batch.Assets))
        {
            try
            {
                var existing = await ledger.GetExistingAsync(batch.RevisionId, a.DraftAssetId, ct);
                if (existing is not null)
                {
                    RememberRef(clientRefToGisId, a, existing);
                    imported.Add(new GisImportedAsset(a.DraftAssetId, existing, a.Kind, a.AssetCode));
                    continue;
                }

                var gisId = await CreateAsync(batch.TenantId, a, clientRefToGisId, ct);

                await ledger.RecordAsync(batch.TenantId, batch.RevisionId, a.DraftAssetId, gisId, a.Kind, a.AssetCode, ct);
                RememberRef(clientRefToGisId, a, gisId);
                imported.Add(new GisImportedAsset(a.DraftAssetId, gisId, a.Kind, a.AssetCode));
            }
            catch (Exception ex) when (ex is DraftMappingException or ConflictException
                                       or BusinessRuleException or DomainException
                                       || PostgresExceptionHelper.IsUniqueViolation(ex))
            {
                failed.Add(new GisImportFailure(a.DraftAssetId, a.AssetCode, ex.Message));
            }
        }

        var completed = GisImportBatch.Completed(batch.RevisionId, batch.TenantId, imported, failed);
        await batchRepository.SaveAsync(completed, ct);   // flushes NetworkGisImportCompleted → outbox
    }

    private static IEnumerable<ReadyForGisAssetV1> Ordered(IReadOnlyList<ReadyForGisAssetV1> assets)
        => assets.Where(a => a.Kind == "Node")
            .Concat(assets.Where(a => a.Kind == "Pipe"))
            .Concat(assets.Where(a => a.Kind == "Device"));

    private static void RememberRef(IDictionary<string, string> map, ReadyForGisAssetV1 a, string gisId)
    {
        if (!string.IsNullOrWhiteSpace(a.ClientRef)) map[a.ClientRef] = gisId;
    }

    private async Task<string> CreateAsync(
        string tenantId, ReadyForGisAssetV1 a, IReadOnlyDictionary<string, string> map, CancellationToken ct)
        => a.Kind switch
        {
            "Node" => await CreateNodeAsync(tenantId, a, ct),
            "Pipe" => await CreatePipeAsync(tenantId, a, map, ct),
            "Device" => await CreateDeviceAsync(tenantId, a, map, ct),
            _ => throw new DraftMappingException($"Draft '{a.AssetCode}': unknown kind '{a.Kind}'.")
        };

    private async Task<string> CreateNodeAsync(string tenantId, ReadyForGisAssetV1 a, CancellationToken ct)
    {
        if (await nodeRepository.ExistsByAssetCodeAsync(tenantId, a.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkNode", "AssetCode", a.AssetCode);

        var (point, nodeType) = DraftAssetMapper.MapNode(a);
        var node = NetworkNode.Register(tenantId, new AssetCode(a.AssetCode), nodeType, point);

        var version = await geometryVersionStore.GetNextVersionAsync(node.Id, ct);
        var geoJson = GeoJsonHelper.GeoJsonPoint(point.Longitude, point.Latitude);
        await geometryVersionStore.AppendAsync(
            GeometryVersion.Create(node.Id, AssetKind.Parse("Node"), version, geoJson, changedBy: "design-import", reason: null), ct);

        await nodeRepository.SaveAsync(node, ct);
        return node.Id;
    }

    private async Task<string> CreatePipeAsync(
        string tenantId, ReadyForGisAssetV1 a, IReadOnlyDictionary<string, string> map, CancellationToken ct)
    {
        if (await pipeRepository.ExistsByAssetCodeAsync(tenantId, a.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkPipe", "AssetCode", a.AssetCode);

        var m = DraftAssetMapper.MapPipe(a, map);
        var calculated = await lengthCalculator.CalculateMetersAsync(
            m.Points.Select(p => new PipePoint(p.Latitude, p.Longitude)).ToList(), ct);  // adapt to actual calc input type
        var lengthM = m.LengthM ?? calculated;

        var pipe = NetworkPipe.Register(
            tenantId, new AssetCode(a.AssetCode), m.FromNodeId, m.ToNodeId,
            new PipeGeometry(m.Points), new Diameter(m.DiameterMm), PipeMaterial.Parse(m.Material),
            lengthM, lengthValidationWarning: null);

        await pipeRepository.SaveAsync(pipe, ct);
        return pipe.Id;
    }

    private async Task<string> CreateDeviceAsync(
        string tenantId, ReadyForGisAssetV1 a, IReadOnlyDictionary<string, string> map, CancellationToken ct)
    {
        if (await deviceRepository.ExistsByAssetCodeAsync(tenantId, a.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkDevice", "AssetCode", a.AssetCode);

        var m = DraftAssetMapper.MapDevice(a, map);
        var deviceType = DeviceType.Parse(m.DeviceType);
        // Host slot (pipe vs node) is decided by DeviceHost.For from the resolved gisId. The batch
        // map points hostRef → gisId; DeviceHost.For decides which slot by deviceType + id shape.
        var host = DeviceHost.For(deviceType,
            hostPipeId: m.HostPipeOrNodeId.StartsWith("pipe-") ? m.HostPipeOrNodeId : null,
            hostNodeId: m.HostPipeOrNodeId.StartsWith("node-") ? m.HostPipeOrNodeId : null);

        var device = NetworkDevice.Install(tenantId, new AssetCode(a.AssetCode), deviceType, host, m.Location);
        await deviceRepository.SaveAsync(device, ct);
        return device.Id;
    }
}
```
> **Adaptation notes for the implementer (verify against real signatures before finalizing):**
> - `IPipeLengthCalculator.CalculateMetersAsync(...)` input type: `RegisterPipeCommandHandler` calls `lengthCalculator.CalculateMetersAsync(command.Points, ct)` where `command.Points` is the command's point list. Reuse whatever type that is — do NOT invent `PipePoint` if the calculator takes `IReadOnlyList<GeoPoint>` or a `PointInput` record. Open `IPipeLengthCalculator` and match exactly.
> - `GeoJsonHelper.GeoJsonPoint`, `GeometryVersion.Create`, `AssetKind.Parse`, `PipeGeometry`, `Diameter`, `PipeMaterial.Parse`, `DeviceType.Parse`, `DeviceHost.For` — all confirmed used by the GIS handlers; copy their exact namespaces/usings from `RegisterNodeCommandHandler.cs`, `RegisterPipeCommandHandler.cs`, `InstallDeviceCommandHandler.cs`.
> - Host slot detection: GIS pipe ids are `pipe-<guid:N>` and node ids are `node-<...>` (NetworkNode.Register id format — verify). If the id-prefix heuristic is fragile, instead carry the host kind explicitly: look up the imported asset's `Kind` from the batch map by storing `(gisId, kind)`. Prefer the explicit-kind approach: change `clientRefToGisId` to `Dictionary<string,(string Id,string Kind)>` and pass kind into `DeviceHost.For`.

- [ ] **Step 4: Add the batch repository (outbox flush for the carrier aggregate)**

The completion event needs the outbox. Add a minimal aggregate repository that persists ONLY domain events.

`Domain/Repositories/IGisImportBatchRepository.cs`:
```csharp
using WaterNetwork.Gis.Domain.Aggregates;

namespace WaterNetwork.Gis.Domain.Repositories;

public interface IGisImportBatchRepository
{
    Task SaveAsync(GisImportBatch batch, CancellationToken ct = default);
}
```
`Infrastructure/Repositories/GisImportBatchRepository.cs`:
```csharp
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>Persists ONLY the import-batch domain events to the outbox (no table for the batch itself).</summary>
public sealed class GisImportBatchRepository(
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository) : IGisImportBatchRepository
{
    public async Task SaveAsync(GisImportBatch batch, CancellationToken ct = default)
    {
        foreach (var e in batch.DomainEvents)
            await outboxRepository.AddAsync(e, ct);
        await eventDispatcher.DispatchAsync(batch.DomainEvents, ct);
        batch.ClearDomainEvents();
    }
}
```
> **Verify the building-block API**: open `AggregateRepositoryBase` (used by `DesignRevisionRepository`) to see EXACTLY how it writes domain events to the outbox (`IOutboxRepository` method name — likely `AddAsync(IDomainEvent)` or `EnqueueAsync`) and whether it dispatches in-process events. Mirror that contract precisely. If `AggregateRepositoryBase` can be reused with a no-op `PersistAsync`, prefer subclassing it (as `DesignRevisionRepository` does) over hand-rolling — that guarantees identical outbox semantics. The hand-rolled version above is a fallback; **prefer subclassing `AggregateRepositoryBase<GisImportBatch>` with a no-op `PersistAsync`** so the carrier reuses the exact outbox path.

- [ ] **Step 5: Register consumer + batch repo in `Program.cs`**

In `WaterNetwork.Gis.Api/Program.cs`:
```csharp
builder.Services.AddScoped<IGisImportBatchRepository, GisImportBatchRepository>();
builder.Services.AddScoped<DesignAssetImportConsumer>();
```
and extend the existing `AddPlatformEventBus` consumer config:
```csharp
builder.Services.AddPlatformEventBus(builder.Configuration, bus =>
{
    bus.AddConsumer<AssetLifecycleProjectionConsumer>();
    bus.AddConsumer<DesignAssetImportConsumer>();
});
```
Add `using WaterNetwork.Gis.Domain.Repositories;` if needed.

- [ ] **Step 6: Run the test**

Run: `dotnet test .../WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter DesignAssetImportConsumerTests --nologo`
Expected: PASS (3 scenarios).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Consumers/DesignAssetImportConsumer.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Repositories/IGisImportBatchRepository.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/GisImportBatchRepository.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/DesignAssetImportConsumerTests.cs
git commit -m "feat(gis): DSN-4 DesignAssetImportConsumer imports batch + emits completed (DSN-4)"
```

---

## Task 12: design-be — `design_import_results` table + store

**Files:**
- Create: `.../WaterNetwork.Design.Infrastructure/Persistence/DesignImportResultPersistenceModel.cs`
- Create: `.../WaterNetwork.Design.Infrastructure/Persistence/Configurations/DesignImportResultConfiguration.cs`
- Create: `.../WaterNetwork.Design.Application/Ports/IDesignImportResultStore.cs`
- Create: `.../WaterNetwork.Design.Infrastructure/Repositories/DesignImportResultStore.cs`
- Migration: generated
- Test: `.../WaterNetwork.Design.IntegrationTests/DesignImportResultStoreTests.cs`

- [ ] **Step 1: Write the failing repo test**

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Application.Ports;
using Xunit;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgres")]
public sealed class DesignImportResultStoreTests
{
    private readonly DesignPostgresFixture _pg;
    public DesignImportResultStoreTests(DesignPostgresFixture pg) => _pg = pg;

    [Fact]
    public async Task Saves_and_lists_import_results()
    {
        await using var factory = new DesignApiFactory(_pg);
        using var scope = factory.Services.CreateScope();
        await Migrate(scope);
        var store = scope.ServiceProvider.GetRequiredService<IDesignImportResultStore>();

        await store.SaveResultsAsync("tenant-1", "rev-1", new[]
        {
            new ImportResultRow("d1", "node-x", "imported", null),
            new ImportResultRow("d2", null, "failed", "duplicate code")
        }, default);

        var rows = await store.ListAsync("tenant-1", "rev-1", default);
        rows.Should().HaveCount(2);
        rows.Should().Contain(r => r.Status == "failed" && r.Reason == "duplicate code");
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/...csproj --filter DesignImportResultStoreTests --nologo`
Expected: FAIL.

- [ ] **Step 3: Persistence model**

`Persistence/DesignImportResultPersistenceModel.cs`:
```csharp
namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignImportResultPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string RevisionId { get; set; } = default!;
    public string DraftAssetId { get; set; } = default!;
    public string? GisAssetId { get; set; }
    public string Status { get; set; } = default!;   // "imported" | "failed"
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

- [ ] **Step 4: EF configuration**

`Persistence/Configurations/DesignImportResultConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignImportResultConfiguration : IEntityTypeConfiguration<DesignImportResultPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignImportResultPersistenceModel> builder)
    {
        builder.ToTable("design_import_results");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.RevisionId).HasColumnName("revision_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DraftAssetId).HasColumnName("draft_asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.GisAssetId).HasColumnName("gis_asset_id").HasMaxLength(64);
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
        builder.Property(x => x.Reason).HasColumnName("reason");
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");

        builder.HasIndex(x => new { x.TenantId, x.RevisionId }).HasDatabaseName("ix_design_import_results_tenant_revision");
        builder.HasIndex(x => new { x.RevisionId, x.DraftAssetId })
            .IsUnique().HasDatabaseName("ux_design_import_results_revision_draft");
    }
}
```

- [ ] **Step 5: Port + store + row record**

`Application/Ports/IDesignImportResultStore.cs`:
```csharp
namespace WaterNetwork.Design.Application.Ports;

public sealed record ImportResultRow(string DraftAssetId, string? GisAssetId, string Status, string? Reason);

public interface IDesignImportResultStore
{
    Task SaveResultsAsync(string tenantId, string revisionId, IReadOnlyList<ImportResultRow> rows, CancellationToken ct);
    Task<IReadOnlyList<ImportResultRow>> ListAsync(string tenantId, string revisionId, CancellationToken ct);
}
```
`Infrastructure/Repositories/DesignImportResultStore.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignImportResultStore(DesignDbContext dbContext) : IDesignImportResultStore
{
    public async Task SaveResultsAsync(string tenantId, string revisionId,
        IReadOnlyList<ImportResultRow> rows, CancellationToken ct)
    {
        // Idempotent re-write: clear prior rows for this revision, then insert.
        var set = dbContext.Set<DesignImportResultPersistenceModel>();
        var existing = await set.Where(x => x.TenantId == tenantId && x.RevisionId == revisionId).ToListAsync(ct);
        set.RemoveRange(existing);
        foreach (var r in rows)
            set.Add(new DesignImportResultPersistenceModel
            {
                Id = Guid.CreateVersion7().ToString(),
                TenantId = tenantId, RevisionId = revisionId, DraftAssetId = r.DraftAssetId,
                GisAssetId = r.GisAssetId, Status = r.Status, Reason = r.Reason, CreatedAt = DateTime.UtcNow
            });
        await dbContext.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<ImportResultRow>> ListAsync(string tenantId, string revisionId, CancellationToken ct)
        => await dbContext.Set<DesignImportResultPersistenceModel>().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RevisionId == revisionId)
            .OrderBy(x => x.DraftAssetId)
            .Select(x => new ImportResultRow(x.DraftAssetId, x.GisAssetId, x.Status, x.Reason))
            .ToListAsync(ct);
}
```

- [ ] **Step 6: Register the store + generate migration**

Add to `Program.cs`: `builder.Services.AddScoped<IDesignImportResultStore, DesignImportResultStore>();`

Run:
```bash
dotnet ef migrations add AddDesignImportResults \
  --project src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj \
  --startup-project src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj \
  --output-dir Persistence/Migrations
```
Verify: creates `design_import_results` + the two indexes; no unrelated churn.

- [ ] **Step 7: Run the test**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/...csproj --filter DesignImportResultStoreTests --nologo`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Persistence \
        src/services/water-network-design-be/src/WaterNetwork.Design.Application/Ports/IDesignImportResultStore.cs \
        src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Repositories/DesignImportResultStore.cs \
        src/services/water-network-design-be/src/WaterNetwork.Design.Api/Program.cs \
        src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/DesignImportResultStoreTests.cs
git commit -m "feat(design): DSN-4 design_import_results table + store (DSN-4)"
```

---

## Task 13: design-be — `GisImportCompletedConsumer` (completion → MarkPublished + report)

**Files:**
- Create: `.../WaterNetwork.Design.Infrastructure/Consumers/GisImportCompletedConsumer.cs`
- Modify: `Program.cs` (enable the lines stubbed in Task 7 Step 4)
- Test: `.../WaterNetwork.Design.IntegrationTests/GisImportCompletedConsumerTests.cs`

- [ ] **Step 1: Write the failing integration test**

```csharp
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Consumers;
using WaterNetwork.Gis.Contracts;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using Xunit;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgres")]
public sealed class GisImportCompletedConsumerTests
{
    private readonly DesignPostgresFixture _pg;
    public GisImportCompletedConsumerTests(DesignPostgresFixture pg) => _pg = pg;

    [Fact]
    public async Task All_imported_sets_Published_and_writes_report()
    {
        await using var factory = new DesignApiFactory(_pg);
        using var scope = factory.Services.CreateScope();
        var sp = scope.ServiceProvider;
        await SeedApprovedRevision(sp, "rev-1", "tenant-1");

        var payload = new NetworkGisImportCompletedV1("rev-1", "tenant-1",
            new[] { new GisImportedAssetV1("d1", "node-x", "Node", "N-1") },
            Array.Empty<GisImportFailureV1>());
        var envelope = new IntegrationEventEnvelope(
            "evt-c1", GisEventTypes.GisImportCompleted, 1, DateTime.UtcNow, "tenant-1",
            null, null, "corr-1", null, "gis-be", JsonSerializer.Serialize(new { Data = payload }));

        var consumer = ActivatorUtilities.CreateInstance<GisImportCompletedConsumer>(sp);
        await consumer.HandleEnvelopeAsync(envelope, CancellationToken.None);

        var revision = await sp.GetRequiredService<IDesignRevisionRepository>().GetByIdAsync("rev-1", default);
        revision!.Status.Should().Be(DesignRevisionStatus.Published);

        var results = await sp.GetRequiredService<IDesignImportResultStore>().ListAsync("tenant-1", "rev-1", default);
        results.Should().ContainSingle(r => r.Status == "imported" && r.GisAssetId == "node-x");
    }

    [Fact]
    public async Task With_failures_sets_PartiallyPublished()
    {
        await using var factory = new DesignApiFactory(_pg);
        using var scope = factory.Services.CreateScope();
        var sp = scope.ServiceProvider;
        await SeedApprovedRevision(sp, "rev-2", "tenant-1");

        var payload = new NetworkGisImportCompletedV1("rev-2", "tenant-1",
            new[] { new GisImportedAssetV1("d1", "node-x", "Node", "N-1") },
            new[] { new GisImportFailureV1("d2", "P-1", "duplicate") });
        var envelope = new IntegrationEventEnvelope(
            "evt-c2", GisEventTypes.GisImportCompleted, 1, DateTime.UtcNow, "tenant-1",
            null, null, "corr-2", null, "gis-be", JsonSerializer.Serialize(new { Data = payload }));

        var consumer = ActivatorUtilities.CreateInstance<GisImportCompletedConsumer>(sp);
        await consumer.HandleEnvelopeAsync(envelope, CancellationToken.None);

        var revision = await sp.GetRequiredService<IDesignRevisionRepository>().GetByIdAsync("rev-2", default);
        revision!.Status.Should().Be(DesignRevisionStatus.PartiallyPublished);
    }
}
```
> `SeedApprovedRevision` must persist a revision in `Approved` status (reuse the helper from Task 7).

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/...csproj --filter GisImportCompletedConsumerTests --nologo`
Expected: FAIL — consumer not defined.

- [ ] **Step 3: Implement the consumer**

`Consumers/GisImportCompletedConsumer.cs`:
```csharp
using System.Text.Json;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Gis.Contracts;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Design.Infrastructure.Consumers;

/// <summary>Consumes network.gis-import.completed and finalises the revision: MarkPublished /
/// MarkPartiallyPublished + persists a per-draft import report.</summary>
public sealed class GisImportCompletedConsumer(
    IDesignRevisionRepository revisionRepository,
    IDesignImportResultStore resultStore,
    IInboxMessageStore inboxMessageStore)
    : IdempotentEnvelopeConsumer(inboxMessageStore)
{
    protected override string ConsumerName => "design.gis-import-completed";

    protected override bool Subscribes(string eventType) => eventType == GisEventTypes.GisImportCompleted;

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var data = doc.RootElement.GetProperty("Data").Deserialize<NetworkGisImportCompletedV1>()
            ?? throw new InvalidOperationException("gis-import-completed payload Data did not deserialize.");

        var revision = await revisionRepository.GetByIdAsync(data.RevisionId, ct);
        if (revision is null) return;

        // Persist the report first (idempotent re-write), then move the aggregate.
        var rows = data.Imported.Select(i => new ImportResultRow(i.DraftAssetId, i.GisAssetId, "imported", null))
            .Concat(data.Failed.Select(f => new ImportResultRow(f.DraftAssetId, null, "failed", f.Reason)))
            .ToList();
        await resultStore.SaveResultsAsync(data.TenantId, data.RevisionId, rows, ct);

        if (revision.Status == DesignRevisionStatus.Approved)
        {
            revision.MarkPublished(data.Imported.Count, data.Failed.Count,
                actorId: "gis-import", correlationId: envelope.CorrelationId);
            await revisionRepository.SaveAsync(revision, ct);
        }
    }
}
```
> Note `revision.MarkPublished` raises `DesignRevisionPublished` → outbox (already mapped in Task 6). The `Status == Approved` guard makes a redelivery (after status already moved) a report-only no-op.

- [ ] **Step 4: Enable the registration in `Program.cs`**

Un-stub the `GisImportCompletedConsumer` lines added in Task 7 Step 4 (both the `AddScoped` and `bus.AddConsumer`).

- [ ] **Step 5: Run the test**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/...csproj --filter GisImportCompletedConsumerTests --nologo`
Expected: PASS (both scenarios).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/Consumers/GisImportCompletedConsumer.cs \
        src/services/water-network-design-be/src/WaterNetwork.Design.Api/Program.cs \
        src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/GisImportCompletedConsumerTests.cs
git commit -m "feat(design): DSN-4 GisImportCompletedConsumer finalises revision + report (DSN-4)"
```

---

## Task 14: design-be — publish-result query + endpoint

**Files:**
- Create: `.../WaterNetwork.Design.Application/Dtos/ImportResultDto.cs`
- Create: `.../WaterNetwork.Design.Application/Queries/GetRevisionPublishResultQuery.cs` (+ handler)
- Modify: `.../WaterNetwork.Design.Api/Endpoints/RevisionsEndpointModule.cs`
- Test: `.../WaterNetwork.Design.IntegrationTests/RevisionPublishResultEndpointTests.cs`

- [ ] **Step 1: Write the failing endpoint test**

```csharp
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgres")]
public sealed class RevisionPublishResultEndpointTests
{
    private readonly DesignPostgresFixture _pg;
    public RevisionPublishResultEndpointTests(DesignPostgresFixture pg) => _pg = pg;

    [Fact]
    public async Task Get_publish_result_returns_rows()
    {
        await using var factory = new DesignApiFactory(_pg);
        // seed a revision + import results via the store (reuse helpers)
        await SeedRevisionWithImportResults(factory, "rev-1", "tenant-1");

        var client = factory.CreateClientWithPermissions("tenant-1", "network-design:read");
        var resp = await client.GetAsync("/api/design/revisions/rev-1/publish-result");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var rows = await resp.Content.ReadFromJsonAsync<List<ImportResultDtoForTest>>();
        rows.Should().NotBeNullOrEmpty();
    }

    private sealed record ImportResultDtoForTest(string DraftAssetId, string? GisAssetId, string Status, string? Reason);
}
```
> Use the SAME auth/permission test helper the DSN-3 endpoint tests use (`DesignRevisionApprovalApiTests.cs` shows how a permissioned client is built — copy `CreateClientWithPermissions` or its equivalent verbatim).

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/...csproj --filter RevisionPublishResultEndpointTests --nologo`
Expected: FAIL (404 — route not mapped).

- [ ] **Step 3: Add the DTO + query + handler**

`Application/Dtos/ImportResultDto.cs`:
```csharp
namespace WaterNetwork.Design.Application.Dtos;

public sealed record ImportResultDto(string DraftAssetId, string? GisAssetId, string Status, string? Reason);
```
`Application/Queries/GetRevisionPublishResultQuery.cs`:
```csharp
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Queries;

public sealed record GetRevisionPublishResultQuery(string RevisionId)
    : IQuery<IReadOnlyList<ImportResultDto>>;

public sealed class GetRevisionPublishResultQueryHandler(
    IDesignImportResultStore store,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetRevisionPublishResultQuery, IReadOnlyList<ImportResultDto>>
{
    public async Task<IReadOnlyList<ImportResultDto>> HandleAsync(GetRevisionPublishResultQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        var rows = await store.ListAsync(tenant.TenantId, query.RevisionId, ct);
        return rows.Select(r => new ImportResultDto(r.DraftAssetId, r.GisAssetId, r.Status, r.Reason)).ToList();
    }
}
```
> Match the EXACT query/handler base interfaces used by `GetDesignRevisionDetailQuery` (open it — `IQuery<T>`/`IQueryHandler<,>` namespaces, and how tenant is obtained). Adapt the using directives accordingly.

- [ ] **Step 4: Map the endpoint**

In `RevisionsEndpointModule.cs`, inside the `group` block (after the `preview` GET):
```csharp
        group.MapGet("/{revisionId}/publish-result",
            async Task<Results<Ok<IReadOnlyList<ImportResultDto>>, NotFound>> (
                string revisionId, IQueryBus bus, CancellationToken ct) =>
            {
                var rows = await bus.ExecuteAsync(new GetRevisionPublishResultQuery(revisionId), ct);
                return TypedResults.Ok(rows);
            })
            .RequirePermission("network-design:read");
```
Add `using WaterNetwork.Design.Application.Queries;` if missing.

- [ ] **Step 5: Run the test**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/...csproj --filter RevisionPublishResultEndpointTests --nologo`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-design-be/src/WaterNetwork.Design.Application/Dtos/ImportResultDto.cs \
        src/services/water-network-design-be/src/WaterNetwork.Design.Application/Queries/GetRevisionPublishResultQuery.cs \
        src/services/water-network-design-be/src/WaterNetwork.Design.Api/Endpoints/RevisionsEndpointModule.cs \
        src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/RevisionPublishResultEndpointTests.cs
git commit -m "feat(design): DSN-4 publish-result query + endpoint (DSN-4)"
```

---

## Task 15: End-to-end round-trip test (cross-service, shared broker)

**Files:**
- Create: `src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/PublishRoundTripTests.cs`

**Goal:** exercise the full loop with both services' DI + a single InMemory MassTransit bus (or a shared RabbitMQ Testcontainer). design-be raises ready-for-gis → gis-be imports → emits completed → design-be finalises. Because each service has its own DbContext/factory, the simplest reliable approach is to drive the consumers directly (no broker) and pass the outbox payloads between them — proving the contract + mapping end-to-end without broker flakiness. (A true broker test is possible but higher-maintenance; the design decision §7.1 only requires the data round-trips correctly.)

- [ ] **Step 1: Write the round-trip test (consumer-driven, no broker)**

```csharp
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Consumers;
using WaterNetwork.Gis.Contracts;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using Xunit;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgres")]
public sealed class PublishRoundTripTests
{
    private readonly DesignPostgresFixture _designPg;
    private readonly PostgisFixture _gisPg;   // requires this test project to reference the GIS test fixtures/factory
    public PublishRoundTripTests(DesignPostgresFixture designPg, PostgisFixture gisPg)
    { _designPg = designPg; _gisPg = gisPg; }

    [Fact]
    public async Task Full_loop_publishes_revision_with_partial_failure()
    {
        // ── design-be: approved revision with 2 nodes + 1 pipe; pre-collide one node code in GIS ──
        await using var designFactory = new DesignApiFactory(_designPg);
        using var designScope = designFactory.Services.CreateScope();
        var designSp = designScope.ServiceProvider;
        await SeedApprovedRevisionWithDrafts(designSp, "rev-rt", "tenant-1");  // N-1, N-2, P-1 (P-1 refs cr-n1/cr-n2)

        // 1) design trigger → ready-for-gis in design outbox
        var approved = new DesignRevisionApprovedV1("rev-rt", "proj-1", "tenant-1", 1, "approver", null);
        var approvedEnv = Env(DesignEventTypes.RevisionApproved, "e1", "tenant-1", new { Data = approved });
        await Activate<RevisionApprovedPublishConsumer>(designSp).HandleEnvelopeAsync(approvedEnv, default);
        var readyForGisPayload = await DrainOutbox(designSp, DesignEventTypes.AssetReadyForGis);

        // ── gis-be: import the batch (pre-create N-2 to force a partial failure) ──
        await using var gisFactory = new GisApiFactory(_gisPg);
        using var gisScope = gisFactory.Services.CreateScope();
        var gisSp = gisScope.ServiceProvider;
        await MigrateGis(gisScope);
        await SeedGisNode(gisSp, "tenant-1", "N-2");   // collision → N-2 lands in failed[]

        var readyEnv = Raw(DesignEventTypes.AssetReadyForGis, "e2", "tenant-1", readyForGisPayload);
        await Activate<DesignAssetImportConsumer>(gisSp).HandleEnvelopeAsync(readyEnv, default);
        var completedPayload = await DrainOutbox(gisSp, GisEventTypes.GisImportCompleted);

        // ── design-be: finalise ──
        var completedEnv = Raw(GisEventTypes.GisImportCompleted, "e3", "tenant-1", completedPayload);
        await Activate<GisImportCompletedConsumer>(designSp).HandleEnvelopeAsync(completedEnv, default);

        var revision = await designSp.GetRequiredService<IDesignRevisionRepository>().GetByIdAsync("rev-rt", default);
        revision!.Status.Should().Be(DesignRevisionStatus.PartiallyPublished);

        var report = await designSp.GetRequiredService<IDesignImportResultStore>().ListAsync("tenant-1", "rev-rt", default);
        report.Should().Contain(r => r.Status == "failed");      // N-2
        report.Count(r => r.Status == "imported").Should().BeGreaterThanOrEqualTo(1);  // N-1 (P-1 may fail if it referenced N-2)
    }

    // Helpers: Env (wrap object), Raw (use a pre-serialized payload string), Activate (ActivatorUtilities),
    // DrainOutbox (GetPendingAsync, find by EventType, return its Payload string), Seed* — implement locally,
    // reusing the existing fixtures and the OutboxEntry.Payload shape.
}
```
> **Cross-project reference:** this test needs both `DesignApiFactory`/`DesignPostgresFixture` and `GisApiFactory`/`PostgisFixture`. If the GIS fixtures aren't referenceable from the design test project, place this test in a small new shared integration test project, OR duplicate the minimal GIS factory. Prefer adding a project reference from `WaterNetwork.Design.IntegrationTests` to the GIS test-fixtures (only if the GIS factory lives in a referenceable class lib). Document whichever you choose at the top of the file.
> **`DrainOutbox`** reads `IOutboxRepository.GetPendingAsync`, finds the entry by `EventType`, and returns the JSON the OutboxProcessor would publish (the `Payload`). The downstream consumer expects the envelope `Payload` to be `{"Data": <V1>}` — confirm the outbox stores the integration event such that `Data` is the V1 record (it does: the mapper wraps the V1 as `Data`). If the outbox payload shape differs, adapt `Raw` to wrap accordingly.

- [ ] **Step 2: Run the round-trip test**

Run: `dotnet test .../WaterNetwork.Design.IntegrationTests/...csproj --filter PublishRoundTripTests --nologo`
Expected: PASS — revision ends `PartiallyPublished`, report has the failed N-2.

- [ ] **Step 3: Commit**

```bash
git add src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/PublishRoundTripTests.cs
git commit -m "test(design): DSN-4 full publish round-trip (design→gis→design) (DSN-4)"
```

---

## Task 16: Full suites green + docs (event catalog, backlog, decision record)

**Files:**
- Modify: `docs/conventions/event-catalog.md`
- Modify: `docs/stories/backlog.md`
- Create: `docs/decisions/0015-design-publish-to-gis-via-events.md`
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` (mark DSN-4 ✓ in §7.3 + §3.3 table)

- [ ] **Step 1: Run ALL test projects for both services**

Run (each csproj separately — never `.slnx`):
```bash
for p in \
  src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj \
  src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj \
  src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj \
  src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj \
  src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/WaterNetwork.Gis.ContractTests.csproj \
  src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj ; do
  dotnet test "$p" --nologo || break
done
```
Expected: ALL green, 0 warnings.

- [ ] **Step 2: Add event-catalog entries**

In `docs/conventions/event-catalog.md`, add `design.asset.ready-for-gis` v1 (producer design-be, consumer gis-be) and `network.gis-import.completed` v1 (producer gis-be, consumer design-be) and `design.revision.published` v1 (producer design-be, no consumer yet) — mirror existing entry format.

- [ ] **Step 3: Update backlog**

In `docs/stories/backlog.md`: mark DSN-4 done in the Phase 2 row; add a "Follow-up sau DSN-4" section capturing: re-publish of failed drafts deferred; cross-revision/existing-asset refs unsupported; `design.revision.published` has no consumer yet; host-slot id-prefix heuristic (if used) is fragile — note the explicit-kind alternative.

- [ ] **Step 4: Write the decision record**

Create `docs/decisions/0015-design-publish-to-gis-via-events.md` documenting: publish-via-event (not HTTP), the two contracts + ownership, idempotency via `gis_import_ledger (revisionId, draftAssetId)`, GIS reuses domain factories (tenant from payload, not command handlers), `Published`/`PartiallyPublished` terminal (no re-publish), intra-batch clientRef resolution + Node→Pipe→Device ordering. Mirror the format of `0014-design-approval-permission-and-audit.md`.

- [ ] **Step 5: Mark the roadmap slice done**

In `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`, update §7.3 #4 (DSN-4) and the §3.3 phase table to ✓ shipped.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs(design): DSN-4 event catalog + decision 0015 + backlog/roadmap (DSN-4)"
```

---

## Self-Review notes (for the executor)

- **Outbox API exactness (Tasks 7, 11):** the single most likely break is the `IOutboxRepository` method name and how `AggregateRepositoryBase` enqueues domain events. Open `AggregateRepositoryBase.cs` and `IOutboxRepository.cs` BEFORE Task 7; prefer subclassing `AggregateRepositoryBase` for `GisImportBatchRepository` (Task 11 Step 4) so outbox semantics are identical to `DesignRevisionRepository`.
- **`IPipeLengthCalculator` input type (Task 11):** mirror `RegisterPipeCommandHandler`'s exact call — do not invent `PipePoint`.
- **Device host slot (Task 11):** prefer carrying `(gisId, kind)` in the batch map over the `pipe-`/`node-` id-prefix heuristic; the id formats are `pipe-<guid:N>` / node id format must be confirmed.
- **Integration-event record shape:** copy verbatim from `DesignRevisionApprovedIntegrationEvent` / `MapNodeRegistered`'s integration event — the positional member order matters for the mapper.
- **Fixture/factory names:** every integration test uses project-specific fixtures (`DesignPostgresFixture`/`DesignApiFactory`, `PostgisFixture`/`GisApiFactory`, collection names, permission-client helper). Copy them from the nearest existing test in the same project; do not assume the names above are exact.
- **Coordinate order** is asserted in `DraftAssetMapperTests` (Task 9) — the one place to catch a lng/lat swap.
- **Order of execution:** Tasks 1→16 are dependency-ordered. Tasks 4–7 (design domain+trigger) and Tasks 8–11 (gis import) are largely independent after Tasks 1–3 (contracts); they can be parallelized across two workers, converging at Task 15.
