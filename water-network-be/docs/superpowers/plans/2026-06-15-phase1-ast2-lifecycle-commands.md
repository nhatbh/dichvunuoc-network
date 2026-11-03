# AST-2 — Asset Lifecycle Commands + Status Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `water-network-asset-be` its lifecycle state machine — activate / mark-maintenance / suspend / decommission + update-technical-profile commands with HTTP endpoints and read queries — emitting the `asset.status.changed` integration event that GIS-5 (and later maintenance/observation) consume.

**Architecture:** Extends the AST-1 `NetworkAsset` aggregate with guarded transition methods (each appends an append-only `AssetLifecycleEntry`, raises domain events) following the state machine `Active ⇄ {UnderMaintenance, Suspended}` → `Decommissioned (terminal)`. Commands mirror the GIS CQRS idiom (`ICommand`/`ICommandHandler`/`ICommandBus`, FluentValidation, minimal-API `IEndpointModule`). Invalid/terminal transitions throw `BusinessRuleException` → HTTP 422. New domain events flow out through the existing transactional Outbox + `AssetIntegrationEventMapper`. Read side uses a Dapper read DAO like GIS.

**Tech Stack:** .NET 10, EF Core 10 + Npgsql (jsonb for the loose technical-profile attributes), Dapper (read DAO), FluentValidation, MassTransit/Outbox (already wired), xUnit + FluentAssertions + Testcontainers.

---

## Decisions baked into this plan (confirmed at planning)

1. **Lean event taxonomy (YAGNI).** Every status transition emits **`asset.status.changed`** (the universal signal GIS-5 consumes). Decommission additionally emits **`asset.decommissioned`** (carries reason/actor). Technical-profile edits emit **`asset.technical-profile.updated`**. The roadmap-listed `asset.activated` / `asset.maintenance-marked` semantic events are **DEFERRED** (no Phase-1 consumer; `asset.status.changed` already conveys the transition) — recorded as a follow-up in decision 0012 (Task 8).
2. **Route prefix.** Per decision `0009-api-route-prefix.md`, services expose `/api/{context}/{resource}` with **no** version segment. GIS already owns `/api/network/assets` (the bbox query), so asset-be's lifecycle resource is **`/api/assets`** (distinct path; gateway versioning is US-X). Endpoints: `/api/assets/{id}/{activate|maintenance|suspend|decommission}`, `/api/assets/{id}/technical-profile`, `GET /api/assets/{id}`, `GET /api/assets`.
3. **One slice** covering lifecycle commands + status events + technical profile + read endpoints, decomposed into 8 small tasks.

## The state machine (authoritative)

```
            ┌─────────────► Active ◄─────────────┐
            │              │     │               │
   Activate │      Suspend │     │ MarkMaintenance│ Activate
            │              ▼     ▼               │
        Suspended      Suspended  UnderMaintenance
            └──────────────┴───────┴─────────────┘
                       (all non-terminal) ──Decommission──► Decommissioned (terminal)
```

| Command | Valid from | To | Domain events raised |
|---|---|---|---|
| `Activate` | `Suspended`, `UnderMaintenance` | `Active` | `AssetStatusChanged` |
| `MarkAsMaintenance` | `Active` | `UnderMaintenance` | `AssetStatusChanged` |
| `Suspend` | `Active` | `Suspended` | `AssetStatusChanged` |
| `Decommission` | `Active`, `UnderMaintenance`, `Suspended` | `Decommissioned` | `AssetStatusChanged` + `AssetDecommissioned` |
| `UpdateTechnicalProfile` | any non-terminal | (status unchanged) | `AssetTechnicalProfileUpdated` |

Rules:
- If `Status == Decommissioned`, **every** command throws `BusinessRuleException.Violation("AssetAlreadyDecommissioned", …)` → **422**.
- A transition from a state not in "Valid from" throws `BusinessRuleException.Violation("InvalidAssetTransition", …)` → **422**.
- Each transition appends `AssetLifecycleEntry(from, to, actorId, reason, occurredAt)` and calls `MarkAsModified()` (Version++).

## Background — established patterns to mirror (read before coding)

| Concern | Reference |
|---|---|
| Aggregate + domain events (AST-1) | `…/WaterNetwork.Asset.Domain/Aggregates/NetworkAsset.cs`, `…/DomainEvents/AssetRegistered.cs` |
| Mutation command/handler | `…/water-network-gis-be/src/WaterNetwork.Gis.Application/Commands/RelocateNodeCommand{,Handler}.cs` |
| Validator | `…/Gis.Application/Validators/RelocateNodeCommandValidator.cs` |
| Endpoint module | `…/Gis.Api/Endpoints/NodesEndpointModule.cs` |
| Query + read DAO + DTO | `…/Gis.Application/Queries/GetNodeDetailQuery{,Handler}.cs`, `…/Gis.Infrastructure/Repositories/NodeReadDao.cs`, `…/Gis.Application/Dtos/NodeDetailDto.cs` |
| Pagination | `…/building-blocks/.../WebApi/Http/PaginationDto.cs` |
| Outbox mapper (extend it) | `…/WaterNetwork.Asset.Infrastructure/IntegrationEvents/AssetIntegrationEventMapper.cs` |
| Repository (update path) | `…/WaterNetwork.Asset.Infrastructure/Repositories/NetworkAssetRepository.cs` |
| Exceptions → HTTP | `…/building-blocks/.../WebApi/Http/GlobalExceptionMiddleware.cs` (`BusinessRuleException`→422, `NotFoundException`→404, `ValidationException`→400) |
| Actor id | handler: `requestContextProvider.Current()?.UserId ?? tenant.TenantId` (see RelocateNodeCommandHandler) |

**Verified facts:** `BusinessRuleException.Violation(rule, message)` → 422. `ICommand<TResult>` / `ICommandHandler<TCommand,TResult>` (`HandleAsync`). `ICommandBus.ExecuteAsync(command, ct)`. Handlers inject `ITenantContextAccessor` + `IRequestContextProvider`. `RegisterFromGis` sets Version 1 with one event; transition methods raise 1 event (Decommission raises 2) and call `MarkAsModified()` once, so `expectedVersion = Version - events.Count` stays consistent — DECOMMISSION RAISES 2 EVENTS so it must bump Version by… see Task 1 note on multi-event version bookkeeping.

> **Version bookkeeping with multi-event transitions (important):** `AggregateRepositoryBase.SaveAsync` computes `expectedVersion = aggregate.Version - events.Count`. For a normal update the row's stored version must equal `expectedVersion`. A single transition that raises **2** events (Decommission) must therefore bump `Version` by **2** (call `MarkAsModified()` twice, or `Version += 2`) so that `expectedVersion == storedVersion`. Single-event transitions bump by 1. Task 1 handles this explicitly and a repository test (Task 5) covers the decommission concurrency path.

---

### Task 1: Domain — lifecycle transition methods + status/decommission events

**Files:**
- Create: `…/Domain/DomainEvents/AssetStatusChanged.cs`, `…/Domain/DomainEvents/AssetDecommissioned.cs`
- Modify: `…/Domain/Aggregates/NetworkAsset.cs`
- Test: `tests/…UnitTests/Domain/NetworkAssetLifecycleTests.cs`

- [ ] **Step 1: Write the failing transition-matrix tests**

`tests/WaterNetwork.Asset.UnitTests/Domain/NetworkAssetLifecycleTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class NetworkAssetLifecycleTests
{
    private static NetworkAsset NewActiveAsset() =>
        NetworkAsset.RegisterFromGis("node-1", "tenant-1", AssetType.Node, "ND-001");

    private static NetworkAsset AssetInStatus(AssetStatus status) =>
        NetworkAsset.Reconstitute("node-1", "tenant-1", AssetType.Node, "ND-001", status,
            version: 1, createdAt: DateTime.UtcNow, updatedAt: DateTime.UtcNow, lifecycleEntries: []);

    [Fact]
    public void Suspend_From_Active_Sets_Suspended_Appends_Entry_Raises_StatusChanged()
    {
        var a = NewActiveAsset();
        a.ClearDomainEvents();
        a.Suspend("user-7", "maintenance window");

        a.Status.Should().Be(AssetStatus.Suspended);
        a.LifecycleEntries.Last().Should().Match<Domain.Entities.AssetLifecycleEntry>(e =>
            e.FromStatus == AssetStatus.Active && e.ToStatus == AssetStatus.Suspended &&
            e.ActorId == "user-7" && e.Reason == "maintenance window");
        var evt = a.GetDomainEvents().OfType<AssetStatusChanged>().Single();
        evt.Data.PreviousStatus.Should().Be("Active");
        evt.Data.NewStatus.Should().Be("Suspended");
        evt.Data.ChangedBy.Should().Be("user-7");
        evt.Data.Reason.Should().Be("maintenance window");
    }

    [Fact]
    public void MarkAsMaintenance_From_Active_Sets_UnderMaintenance()
    {
        var a = NewActiveAsset();
        a.MarkAsMaintenance("user-7", null);
        a.Status.Should().Be(AssetStatus.UnderMaintenance);
        a.GetDomainEvents().OfType<AssetStatusChanged>().Last().Data.NewStatus.Should().Be("UnderMaintenance");
    }

    [Theory]
    [InlineData(AssetStatus.Suspended)]
    [InlineData(AssetStatus.UnderMaintenance)]
    public void Activate_From_Suspended_Or_Maintenance_Sets_Active(AssetStatus from)
    {
        var a = AssetInStatus(from);
        a.Activate("user-7", "back online");
        a.Status.Should().Be(AssetStatus.Active);
        a.GetDomainEvents().OfType<AssetStatusChanged>().Last().Data.NewStatus.Should().Be("Active");
    }

    [Theory]
    [InlineData(AssetStatus.Active)]
    [InlineData(AssetStatus.UnderMaintenance)]
    [InlineData(AssetStatus.Suspended)]
    public void Decommission_From_NonTerminal_Sets_Decommissioned_Raises_Two_Events_And_Bumps_Version_By_Two(AssetStatus from)
    {
        var a = AssetInStatus(from);
        var v0 = a.Version;
        a.Decommission("user-7", "end of life");

        a.Status.Should().Be(AssetStatus.Decommissioned);
        a.Version.Should().Be(v0 + 2, "decommission raises 2 events so version must advance by 2 for outbox/concurrency bookkeeping");
        a.GetDomainEvents().OfType<AssetStatusChanged>().Single().Data.NewStatus.Should().Be("Decommissioned");
        var dec = a.GetDomainEvents().OfType<AssetDecommissioned>().Single();
        dec.Data.Reason.Should().Be("end of life");
        dec.Data.DecommissionedBy.Should().Be("user-7");
        a.DecommissionReason.Should().Be("end of life");
        a.DecommissionedBy.Should().Be("user-7");
    }

    [Theory]
    [InlineData(AssetStatus.Active)]      // Activate invalid from Active
    public void Activate_From_Active_Throws_InvalidTransition(AssetStatus from)
    {
        var a = AssetInStatus(from);
        var act = () => a.Activate("user-7", null);
        act.Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("InvalidAssetTransition");
    }

    [Theory]
    [InlineData(AssetStatus.Suspended)]
    [InlineData(AssetStatus.UnderMaintenance)]
    public void MarkAsMaintenance_From_NonActive_Throws_InvalidTransition(AssetStatus from)
    {
        var act = () => AssetInStatus(from).MarkAsMaintenance("user-7", null);
        act.Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("InvalidAssetTransition");
    }

    [Theory]
    [InlineData(AssetStatus.Suspended)]
    [InlineData(AssetStatus.UnderMaintenance)]
    public void Suspend_From_NonActive_Throws_InvalidTransition(AssetStatus from)
    {
        var act = () => AssetInStatus(from).Suspend("user-7", null);
        act.Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("InvalidAssetTransition");
    }

    [Fact]
    public void Any_Command_On_Decommissioned_Throws_AlreadyDecommissioned()
    {
        var a = AssetInStatus(AssetStatus.Decommissioned);
        a.Invoking(x => x.Activate("u", null)).Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("AssetAlreadyDecommissioned");
        a.Invoking(x => x.Suspend("u", null)).Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("AssetAlreadyDecommissioned");
        a.Invoking(x => x.MarkAsMaintenance("u", null)).Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("AssetAlreadyDecommissioned");
        a.Invoking(x => x.Decommission("u", null)).Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("AssetAlreadyDecommissioned");
    }
}
```

- [ ] **Step 2: Run → RED** (`dotnet test …UnitTests` → methods/types missing).

- [ ] **Step 3: Implement the domain events**

`…/Domain/DomainEvents/AssetStatusChanged.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.Domain.DomainEvents;

public sealed record AssetStatusChangedData(
    string AssetType,
    string PreviousStatus,
    string NewStatus,
    string? Reason,
    string ChangedBy);

public sealed record AssetStatusChanged(string AggregateId, AssetStatusChangedData Data)
    : DomainEventBase<AssetStatusChangedData>(
        aggregateId: AggregateId, aggregateType: "NetworkAsset", eventType: "AssetStatusChanged", data: Data);
```

`…/Domain/DomainEvents/AssetDecommissioned.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.Domain.DomainEvents;

public sealed record AssetDecommissionedData(
    string AssetType,
    string? Reason,
    string DecommissionedBy);

public sealed record AssetDecommissioned(string AggregateId, AssetDecommissionedData Data)
    : DomainEventBase<AssetDecommissionedData>(
        aggregateId: AggregateId, aggregateType: "NetworkAsset", eventType: "AssetDecommissioned", data: Data);
```

- [ ] **Step 4: Extend `NetworkAsset` with the transition methods**

Add to `…/Domain/Aggregates/NetworkAsset.cs` (new fields + methods; keep existing `RegisterFromGis`/`Reconstitute`):
```csharp
    public string? DecommissionReason { get; private set; }
    public string? DecommissionedBy { get; private set; }

    public void Activate(string changedBy, string? reason)
        => Transition(changedBy, reason, AssetStatus.Active, validFrom: [AssetStatus.Suspended, AssetStatus.UnderMaintenance]);

    public void MarkAsMaintenance(string changedBy, string? reason)
        => Transition(changedBy, reason, AssetStatus.UnderMaintenance, validFrom: [AssetStatus.Active]);

    public void Suspend(string changedBy, string? reason)
        => Transition(changedBy, reason, AssetStatus.Suspended, validFrom: [AssetStatus.Active]);

    public void Decommission(string changedBy, string? reason)
    {
        GuardNotDecommissioned();
        // Decommission is allowed from any non-terminal state (Active/UnderMaintenance/Suspended).
        var previous = Status;
        ApplyStatus(previous, AssetStatus.Decommissioned, changedBy, reason);
        DecommissionReason = reason;
        DecommissionedBy = changedBy;
        // Second event for the same transition → bump version again so expectedVersion bookkeeping holds.
        MarkAsModified();
        AddDomainEvent(new AssetDecommissioned(Id, new AssetDecommissionedData(
            AssetType: AssetType.ToString(), Reason: reason, DecommissionedBy: changedBy)));
    }

    private void Transition(string changedBy, string? reason, AssetStatus target, AssetStatus[] validFrom)
    {
        GuardNotDecommissioned();
        if (Array.IndexOf(validFrom, Status) < 0)
            throw BusinessRuleException.Violation("InvalidAssetTransition",
                $"Cannot move asset from {Status} to {target}.");
        ApplyStatus(Status, target, changedBy, reason);
    }

    private void ApplyStatus(AssetStatus from, AssetStatus to, string changedBy, string? reason)
    {
        Status = to;
        _lifecycleEntries.Add(new AssetLifecycleEntry(from, to, changedBy, reason, DateTime.UtcNow));
        MarkAsModified();
        AddDomainEvent(new AssetStatusChanged(Id, new AssetStatusChangedData(
            AssetType: AssetType.ToString(),
            PreviousStatus: from.ToString(),
            NewStatus: to.ToString(),
            Reason: reason,
            ChangedBy: changedBy)));
    }

    private void GuardNotDecommissioned()
    {
        if (Status == AssetStatus.Decommissioned)
            throw BusinessRuleException.Violation("AssetAlreadyDecommissioned",
                "Asset is decommissioned (terminal); no further lifecycle changes are allowed.");
    }
```
Add `using WaterPlatform.BuildingBlocks.Domain.Exceptions;` to the file. Update `Reconstitute` to also accept the decommission fields:
```csharp
    public static NetworkAsset Reconstitute(
        string id, string tenantId, AssetType assetType, string assetCode, AssetStatus status,
        int version, DateTime createdAt, DateTime updatedAt, IEnumerable<AssetLifecycleEntry> lifecycleEntries,
        string? decommissionReason = null, string? decommissionedBy = null)
    {
        var asset = new NetworkAsset(id, tenantId, assetType, assetCode, status, version, createdAt, updatedAt);
        asset._lifecycleEntries.AddRange(lifecycleEntries);
        asset.DecommissionReason = decommissionReason;
        asset.DecommissionedBy = decommissionedBy;
        return asset;
    }
```
(The existing `Reconstitute` call site in `NetworkAssetRepository.ToDomain` keeps compiling because the new params are optional; Task 5 wires them.)

- [ ] **Step 5: Run → GREEN** (`dotnet test …UnitTests`). Build solution → 0 warnings.

- [ ] **Step 6: Commit**
```bash
git add src/services/water-network-asset-be/src/WaterNetwork.Asset.Domain \
        src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests
git commit -m "feat(asset): lifecycle state machine + status/decommission domain events (AST-2)"
```

---

### Task 2: Domain — `AssetTechnicalProfile` + UpdateTechnicalProfile

**Files:**
- Create: `…/Domain/Entities/AssetTechnicalProfile.cs`, `…/Domain/DomainEvents/AssetTechnicalProfileUpdated.cs`
- Modify: `…/Domain/Aggregates/NetworkAsset.cs`
- Test: `tests/…UnitTests/Domain/AssetTechnicalProfileTests.cs`

- [ ] **Step 1: Write failing tests**

`tests/WaterNetwork.Asset.UnitTests/Domain/AssetTechnicalProfileTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class AssetTechnicalProfileTests
{
    private static NetworkAsset NewActiveAsset() =>
        NetworkAsset.RegisterFromGis("node-1", "tenant-1", AssetType.Node, "ND-001");

    [Fact]
    public void UpdateTechnicalProfile_Sets_Fields_And_Raises_Event()
    {
        var a = NewActiveAsset();
        a.ClearDomainEvents();
        a.UpdateTechnicalProfile("user-7", installationYear: 2019, manufacturer: "Acme",
            model: "V-200", attributes: new Dictionary<string, string?> { ["pressureRating"] = "PN16" });

        a.TechnicalProfile.Should().NotBeNull();
        a.TechnicalProfile!.InstallationYear.Should().Be(2019);
        a.TechnicalProfile.Manufacturer.Should().Be("Acme");
        a.TechnicalProfile.Model.Should().Be("V-200");
        a.TechnicalProfile.Attributes["pressureRating"].Should().Be("PN16");

        var evt = a.GetDomainEvents().OfType<AssetTechnicalProfileUpdated>().Single();
        evt.Data.InstallationYear.Should().Be(2019);
        evt.Data.Manufacturer.Should().Be("Acme");
    }

    [Fact]
    public void UpdateTechnicalProfile_Rejects_Implausible_InstallationYear()
    {
        var a = NewActiveAsset();
        a.Invoking(x => x.UpdateTechnicalProfile("user-7", installationYear: 1800, manufacturer: null, model: null,
                attributes: new Dictionary<string, string?>()))
            .Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("InvalidInstallationYear");
    }

    [Fact]
    public void UpdateTechnicalProfile_On_Decommissioned_Throws()
    {
        var a = NetworkAsset.Reconstitute("node-1", "tenant-1", AssetType.Node, "ND-001",
            AssetStatus.Decommissioned, 1, DateTime.UtcNow, DateTime.UtcNow, []);
        a.Invoking(x => x.UpdateTechnicalProfile("u", 2019, null, null, new Dictionary<string, string?>()))
            .Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("AssetAlreadyDecommissioned");
    }
}
```

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement the entity, event, and method**

`…/Domain/Entities/AssetTechnicalProfile.cs`:
```csharp
namespace WaterNetwork.Asset.Domain.Entities;

/// <summary>1-1 technical profile: a few hard fields + loose key-value attributes (persisted as jsonb).</summary>
public sealed class AssetTechnicalProfile
{
    public int? InstallationYear { get; }
    public string? Manufacturer { get; }
    public string? Model { get; }
    public IReadOnlyDictionary<string, string?> Attributes { get; }

    public AssetTechnicalProfile(int? installationYear, string? manufacturer, string? model,
        IReadOnlyDictionary<string, string?> attributes)
    {
        InstallationYear = installationYear;
        Manufacturer = manufacturer;
        Model = model;
        Attributes = attributes;
    }
}
```

`…/Domain/DomainEvents/AssetTechnicalProfileUpdated.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.Domain.DomainEvents;

public sealed record AssetTechnicalProfileUpdatedData(
    string AssetType, int? InstallationYear, string? Manufacturer, string? Model);

public sealed record AssetTechnicalProfileUpdated(string AggregateId, AssetTechnicalProfileUpdatedData Data)
    : DomainEventBase<AssetTechnicalProfileUpdatedData>(
        aggregateId: AggregateId, aggregateType: "NetworkAsset",
        eventType: "AssetTechnicalProfileUpdated", data: Data);
```

Add to `NetworkAsset`:
```csharp
    public AssetTechnicalProfile? TechnicalProfile { get; private set; }

    public void UpdateTechnicalProfile(string changedBy, int? installationYear, string? manufacturer,
        string? model, IReadOnlyDictionary<string, string?> attributes)
    {
        GuardNotDecommissioned();
        if (installationYear is < 1900 or > 2100)
            throw BusinessRuleException.Violation("InvalidInstallationYear",
                $"installationYear {installationYear} is out of the plausible range 1900–2100.");

        TechnicalProfile = new AssetTechnicalProfile(installationYear, manufacturer, model, attributes);
        MarkAsModified();
        AddDomainEvent(new AssetTechnicalProfileUpdated(Id, new AssetTechnicalProfileUpdatedData(
            AssetType.ToString(), installationYear, manufacturer, model)));
    }
```
Also extend `Reconstitute` to accept an optional `AssetTechnicalProfile? technicalProfile = null` parameter and assign it (append after the decommission params). Update the persistence rehydration in Task 5 to pass it.

- [ ] **Step 4: Run → GREEN.** Build → 0 warnings.

- [ ] **Step 5: Commit**
```bash
git add src/services/water-network-asset-be/src/WaterNetwork.Asset.Domain \
        src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests
git commit -m "feat(asset): technical profile entity + UpdateTechnicalProfile (AST-2)"
```

---

### Task 3: Contracts — `asset.status.changed` (+ decommissioned, technical-profile.updated)

**Files:**
- Create: `…/Contracts/Events/AssetStatusChangedV1.cs`, `…/Contracts/Events/AssetDecommissionedV1.cs`, `…/Contracts/Events/AssetTechnicalProfileUpdatedV1.cs`
- Modify: `…/Contracts/AssetEventTypes.cs`
- Test: `tests/…ContractTests/AssetStatusChangedContractTests.cs`

- [ ] **Step 1: Write failing contract tests** (status.changed is the load-bearing one — pin it first)

`tests/WaterNetwork.Asset.ContractTests/AssetStatusChangedContractTests.cs`:
```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;

namespace WaterNetwork.Asset.ContractTests;

public class AssetStatusChangedContractTests
{
    [Fact]
    public void StatusChanged_V1_Schema_Is_Stable()
    {
        var evt = new AssetStatusChangedV1("node-1", "Node", "Active", "Suspended", "reason", "user-7");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Equal("AssetId", "AssetType", "PreviousStatus", "NewStatus", "Reason", "ChangedBy");
    }

    [Fact]
    public void EventType_Constants_Are_Fixed()
    {
        AssetEventTypes.StatusChanged.Should().Be("asset.status.changed");
        AssetEventTypes.Decommissioned.Should().Be("asset.decommissioned");
        AssetEventTypes.TechnicalProfileUpdated.Should().Be("asset.technical-profile.updated");
    }

    [Fact]
    public void Decommissioned_V1_Schema_Is_Stable()
    {
        var evt = new AssetDecommissionedV1("node-1", "Node", "eol", "user-7");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Equal("AssetId", "AssetType", "Reason", "DecommissionedBy");
    }

    [Fact]
    public void TechnicalProfileUpdated_V1_Schema_Is_Stable()
    {
        var evt = new AssetTechnicalProfileUpdatedV1("node-1", "Node", 2019, "Acme", "V-200");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Equal("AssetId", "AssetType", "InstallationYear", "Manufacturer", "Model");
    }
}
```

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement contracts**

`…/Contracts/Events/AssetStatusChangedV1.cs`:
```csharp
namespace WaterNetwork.Asset.Contracts.Events;

/// <summary>
/// v1 payload for <c>asset.status.changed</c> — the universal lifecycle-transition signal.
/// Consumed by GIS-5 (projection) and later maintenance/observation. Emitted on EVERY transition.
/// </summary>
public sealed record AssetStatusChangedV1(
    string AssetId, string AssetType, string PreviousStatus, string NewStatus, string? Reason, string ChangedBy);
```
`…/Contracts/Events/AssetDecommissionedV1.cs`:
```csharp
namespace WaterNetwork.Asset.Contracts.Events;

/// <summary>v1 payload for <c>asset.decommissioned</c> — emitted additionally on decommission.</summary>
public sealed record AssetDecommissionedV1(string AssetId, string AssetType, string? Reason, string DecommissionedBy);
```
`…/Contracts/Events/AssetTechnicalProfileUpdatedV1.cs`:
```csharp
namespace WaterNetwork.Asset.Contracts.Events;

/// <summary>
/// v1 payload for <c>asset.technical-profile.updated</c>. Loose attributes are intentionally
/// excluded from the event — consumers needing them query GET /api/assets/{id}.
/// </summary>
public sealed record AssetTechnicalProfileUpdatedV1(
    string AssetId, string AssetType, int? InstallationYear, string? Manufacturer, string? Model);
```
Extend `…/Contracts/AssetEventTypes.cs`:
```csharp
namespace WaterNetwork.Asset.Contracts;

public static class AssetEventTypes
{
    public const string AssetRegistered = "asset.registered";
    public const string StatusChanged = "asset.status.changed";
    public const string Decommissioned = "asset.decommissioned";
    public const string TechnicalProfileUpdated = "asset.technical-profile.updated";
}
```

- [ ] **Step 4: Run → GREEN.** Build → 0 warnings.

- [ ] **Step 5: Commit**
```bash
git add src/services/water-network-asset-be/src/WaterNetwork.Asset.Contracts \
        src/services/water-network-asset-be/tests/WaterNetwork.Asset.ContractTests
git commit -m "feat(asset): asset.status.changed/decommissioned/technical-profile.updated v1 contracts (AST-2)"
```

---

### Task 4: Outbox mapper — map the 3 new domain events

**Files:**
- Modify: `…/Infrastructure/IntegrationEvents/AssetIntegrationEventMapper.cs`
- Test: `tests/…IntegrationTests/AssetStatusChangedOutboxTests.cs`

- [ ] **Step 1: Write failing outbox pipeline test** (mirror the AST-1 `OutboxPublishPipelineTests` capturing-publisher pattern; drive a status transition through the repo + OutboxProcessor):
```csharp
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public class AssetStatusChangedOutboxTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private sealed class CapturingPublisher : IIntegrationEventPublisher
    {
        public List<IIntegrationEvent> Published { get; } = [];
        public Task PublishAsync(IIntegrationEvent e, CancellationToken ct = default) { Published.Add(e); return Task.CompletedTask; }
    }

    [Fact]
    public async Task Suspend_Publishes_Typed_StatusChanged_Event()
    {
        var publisher = new CapturingPublisher();
        await using var factory = new AssetApiFactory(postgis).WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            foreach (var d in s.Where(x => x.ServiceType == typeof(IIntegrationEventPublisher)).ToList()) s.Remove(d);
            s.AddSingleton<IIntegrationEventPublisher>(publisher);
        }));

        var id = $"node-{Guid.CreateVersion7():N}";
        using (var scope = factory.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<AssetDbContext>().Database.MigrateAsync();
            var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
            var asset = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[..8]}");
            await repo.SaveAsync(asset);              // asset.registered
            asset.Suspend("user-7", "win");
            await repo.SaveAsync(asset);              // asset.status.changed
        }
        using (var scope = factory.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IOutboxProcessor>().ProcessOutboxAsync(CancellationToken.None);

        var statusChanged = publisher.Published.Where(e => e.EventType == AssetEventTypes.StatusChanged).ToList();
        statusChanged.Should().ContainSingle();
        statusChanged[0].GetType().Name.Should().Be("AssetStatusChangedIntegrationEvent");
        statusChanged[0].SourceAggregateId.Should().Be(id);
    }
}
```

- [ ] **Step 2: Run → RED** (mapper has no entry for `AssetStatusChanged` → goes to fallback / not the typed event).

- [ ] **Step 3: Extend the mapper** — add 3 concrete integration-event records + 3 registry entries (mirror the existing `AssetRegisteredIntegrationEvent` shape):
```csharp
public sealed record AssetStatusChangedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, AssetStatusChangedV1 Data)
    : IIntegrationEvent<AssetStatusChangedV1>;

public sealed record AssetDecommissionedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, AssetDecommissionedV1 Data)
    : IIntegrationEvent<AssetDecommissionedV1>;

public sealed record AssetTechnicalProfileUpdatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, AssetTechnicalProfileUpdatedV1 Data)
    : IIntegrationEvent<AssetTechnicalProfileUpdatedV1>;
```
Add registry entries (alongside the existing `["AssetRegistered"]`):
```csharp
["AssetStatusChanged"] = e => e is AssetStatusChanged x ? MapStatusChanged(x) : null,
["AssetDecommissioned"] = e => e is AssetDecommissioned x ? MapDecommissioned(x) : null,
["AssetTechnicalProfileUpdated"] = e => e is AssetTechnicalProfileUpdated x ? MapTechProfile(x) : null,
```
And the three `MapXxx` methods that build each integration event with `EventType = AssetEventTypes.StatusChanged/Decommissioned/TechnicalProfileUpdated`, `EventVersion: 1`, copying `EventId/OccurredAt/AggregateId/AggregateType`, and `Data` from the domain event's `Data` (map each field across). The new domain-event types are auto-registered with the outbox type resolver because `Program.cs` already calls `AddOutboxDomainEventTypesFromAssembly(typeof(AssetRegistered).Assembly)` (same assembly).

- [ ] **Step 4: Run → GREEN.** Build → 0 warnings.

- [ ] **Step 5: Commit**
```bash
git add src/services/water-network-asset-be
git commit -m "feat(asset): map status.changed/decommissioned/technical-profile.updated to outbox events (AST-2)"
```

---

### Task 5: Persistence — technical_profiles + decommission columns + update-path lifecycle append + migration

**Files:**
- Create: `…/Infrastructure/Persistence/AssetTechnicalProfilePersistenceModel.cs`, `…/Configurations/AssetTechnicalProfileConfiguration.cs`
- Modify: `…/Infrastructure/Persistence/NetworkAssetPersistenceModel.cs` (add decommission cols + technical-profile nav), `…/Configurations/NetworkAssetConfiguration.cs`, `…/Persistence/AssetDbContext.cs` (new DbSet), `…/Repositories/NetworkAssetRepository.cs` (update-path: append new lifecycle entries, upsert profile, map decommission fields)
- Create: migration `Persistence/Migrations/*_AddLifecycleAndTechnicalProfile.cs` (generated)
- Test: `tests/…IntegrationTests/AssetLifecyclePersistenceTests.cs`

- [ ] **Step 1: Write failing persistence tests** (transition persists + lifecycle row appended + profile round-trips + decommission fields):
```csharp
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public class AssetLifecyclePersistenceTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static (AssetApiFactory, IServiceScope) Boot()
    {
        var f = new AssetApiFactory(postgis);
        var s = f.Services.CreateScope();
        s.ServiceProvider.GetRequiredService<AssetDbContext>().Database.Migrate();
        return (f, s);
    }

    [Fact]
    public async Task Transition_Then_Reload_Persists_Status_And_Appends_Lifecycle_Entry()
    {
        var (f, scope) = Boot(); await using var _ = f; using var __ = scope;
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var id = $"node-{Guid.CreateVersion7():N}";
        var a = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[..8]}");
        await repo.SaveAsync(a);
        a.Suspend("user-7", "win");
        await repo.SaveAsync(a);

        var reloaded = await repo.GetByIdAsync(id);
        reloaded!.Status.Should().Be(AssetStatus.Suspended);
        reloaded.LifecycleEntries.Should().HaveCount(2); // Registered→Active, Active→Suspended
        reloaded.LifecycleEntries.Last().ToStatus.Should().Be(AssetStatus.Suspended);
    }

    [Fact]
    public async Task UpdateTechnicalProfile_Then_Reload_RoundTrips_Jsonb_Attributes()
    {
        var (f, scope) = Boot(); await using var _ = f; using var __ = scope;
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var id = $"node-{Guid.CreateVersion7():N}";
        var a = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[..8]}");
        await repo.SaveAsync(a);
        a.UpdateTechnicalProfile("user-7", 2019, "Acme", "V-200",
            new Dictionary<string, string?> { ["pressureRating"] = "PN16" });
        await repo.SaveAsync(a);

        var reloaded = await repo.GetByIdAsync(id);
        reloaded!.TechnicalProfile!.InstallationYear.Should().Be(2019);
        reloaded.TechnicalProfile.Attributes["pressureRating"].Should().Be("PN16");
    }

    [Fact]
    public async Task Decommission_Then_Reload_Persists_Terminal_State_And_Record()
    {
        var (f, scope) = Boot(); await using var _ = f; using var __ = scope;
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var id = $"node-{Guid.CreateVersion7():N}";
        var a = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[..8]}");
        await repo.SaveAsync(a);
        a.Decommission("user-7", "eol");
        await repo.SaveAsync(a);

        var reloaded = await repo.GetByIdAsync(id);
        reloaded!.Status.Should().Be(AssetStatus.Decommissioned);
        reloaded.DecommissionReason.Should().Be("eol");
        reloaded.DecommissionedBy.Should().Be("user-7");
    }
}
```

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement persistence models + config**

Add to `NetworkAssetPersistenceModel`:
```csharp
    public string? DecommissionReason { get; set; }
    public string? DecommissionedBy { get; set; }
    public AssetTechnicalProfilePersistenceModel? TechnicalProfile { get; set; }
```
`AssetTechnicalProfilePersistenceModel.cs`:
```csharp
namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class AssetTechnicalProfilePersistenceModel
{
    public string AssetId { get; set; } = default!;   // PK + FK (1-1)
    public int? InstallationYear { get; set; }
    public string? Manufacturer { get; set; }
    public string? Model { get; set; }
    public string AttributesJson { get; set; } = "{}"; // jsonb-serialized Dictionary<string,string?>
}
```
`AssetTechnicalProfileConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Asset.Infrastructure.Persistence.Configurations;

public sealed class AssetTechnicalProfileConfiguration : IEntityTypeConfiguration<AssetTechnicalProfilePersistenceModel>
{
    public void Configure(EntityTypeBuilder<AssetTechnicalProfilePersistenceModel> b)
    {
        b.ToTable("asset_technical_profiles");
        b.HasKey(x => x.AssetId);
        b.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64);
        b.Property(x => x.InstallationYear).HasColumnName("installation_year");
        b.Property(x => x.Manufacturer).HasColumnName("manufacturer").HasMaxLength(128);
        b.Property(x => x.Model).HasColumnName("model").HasMaxLength(128);
        b.Property(x => x.AttributesJson).HasColumnName("attributes").HasColumnType("jsonb").IsRequired();
    }
}
```
Extend `NetworkAssetConfiguration.Configure`:
```csharp
        builder.Property(x => x.DecommissionReason).HasColumnName("decommission_reason").HasMaxLength(256);
        builder.Property(x => x.DecommissionedBy).HasColumnName("decommissioned_by").HasMaxLength(64);
        builder.HasOne(x => x.TechnicalProfile)
            .WithOne()
            .HasForeignKey<AssetTechnicalProfilePersistenceModel>(p => p.AssetId)
            .OnDelete(DeleteBehavior.Cascade);
```
Add the DbSet to `AssetDbContext`:
```csharp
    public DbSet<AssetTechnicalProfilePersistenceModel> AssetTechnicalProfiles => Set<AssetTechnicalProfilePersistenceModel>();
```

- [ ] **Step 4: Update the repository (`NetworkAssetRepository`)**

The update path must (a) map decommission fields, (b) **append new lifecycle entries** (entries are append-only; insert only the ones not yet persisted), (c) upsert the technical profile. Update `PersistAsync`'s `else` (existing) branch:
```csharp
        else
        {
            if (existing.Version != expectedVersion)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);

            existing.Status = aggregate.Status.ToString();
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
            existing.DecommissionReason = aggregate.DecommissionReason;
            existing.DecommissionedBy = aggregate.DecommissionedBy;

            // Append-only lifecycle entries: insert the ones added since the last persist.
            var newEntries = aggregate.LifecycleEntries.Skip(existing.LifecycleEntries.Count);
            foreach (var e in newEntries)
                existing.LifecycleEntries.Add(new AssetLifecycleEntryPersistenceModel
                {
                    AssetId = aggregate.Id, FromStatus = e.FromStatus.ToString(), ToStatus = e.ToStatus.ToString(),
                    ActorId = e.ActorId, Reason = e.Reason, OccurredAt = e.OccurredAt
                });

            // Upsert 1-1 technical profile.
            if (aggregate.TechnicalProfile is { } tp)
            {
                existing.TechnicalProfile ??= new AssetTechnicalProfilePersistenceModel { AssetId = aggregate.Id };
                existing.TechnicalProfile.InstallationYear = tp.InstallationYear;
                existing.TechnicalProfile.Manufacturer = tp.Manufacturer;
                existing.TechnicalProfile.Model = tp.Model;
                existing.TechnicalProfile.AttributesJson =
                    System.Text.Json.JsonSerializer.Serialize(tp.Attributes);
            }
        }
```
Also: the load in `PersistAsync` and `GetByIdAsync` must `.Include(x => x.TechnicalProfile)` in addition to `.Include(x => x.LifecycleEntries)`. Update `ToModel` to include decommission fields + technical profile. Update `ToDomain` to pass decommission fields + reconstruct `AssetTechnicalProfile` (deserialize `AttributesJson`):
```csharp
    private static NetworkAsset ToDomain(NetworkAssetPersistenceModel m)
    {
        Domain.Entities.AssetTechnicalProfile? profile = m.TechnicalProfile is null ? null :
            new Domain.Entities.AssetTechnicalProfile(
                m.TechnicalProfile.InstallationYear, m.TechnicalProfile.Manufacturer, m.TechnicalProfile.Model,
                System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string?>>(m.TechnicalProfile.AttributesJson)
                    ?? new Dictionary<string, string?>());
        return NetworkAsset.Reconstitute(
            m.Id, m.TenantId, Enum.Parse<AssetType>(m.AssetType), m.AssetCode, Enum.Parse<AssetStatus>(m.Status),
            m.Version, m.CreatedAt, m.UpdatedAt,
            m.LifecycleEntries.Select(e => new AssetLifecycleEntry(
                Enum.Parse<AssetStatus>(e.FromStatus), Enum.Parse<AssetStatus>(e.ToStatus), e.ActorId, e.Reason, e.OccurredAt)),
            m.DecommissionReason, m.DecommissionedBy, profile);
    }
```
Make sure `Reconstitute`'s signature (Tasks 1–2) ends with `(…, decommissionReason, decommissionedBy, technicalProfile)` matching this call. Update `ToModel` similarly to persist a fresh insert that already has a profile (rare on insert; safe to include).

- [ ] **Step 5: Generate the migration**
```bash
dotnet ef migrations add AddLifecycleAndTechnicalProfile \
  -p src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure/WaterNetwork.Asset.Infrastructure.csproj \
  -s src/services/water-network-asset-be/src/WaterNetwork.Asset.Api/WaterNetwork.Asset.Api.csproj \
  -o Persistence/Migrations
```
Confirm it adds: `asset_technical_profiles` table (with `attributes jsonb`) + `decommission_reason`/`decommissioned_by` columns on `network_assets`.

- [ ] **Step 6: Run → GREEN** (all 3 persistence tests + existing tests). Build → 0 warnings.

- [ ] **Step 7: Commit**
```bash
git add src/services/water-network-asset-be
git commit -m "feat(asset): persist lifecycle transitions, decommission record, technical profile jsonb + migration (AST-2)"
```

---

### Task 6: Application — 5 commands + handlers + validators

**Files:**
- Create under `…/Application/Commands/`: `ActivateAssetCommand{,Handler}.cs`, `MarkAssetAsMaintenanceCommand{,Handler}.cs`, `SuspendAssetCommand{,Handler}.cs`, `DecommissionAssetCommand{,Handler}.cs`, `UpdateAssetTechnicalProfileCommand{,Handler}.cs`
- Create under `…/Application/Validators/`: validators for the commands that need them (decommission reason, technical profile)
- Modify: `…/Api/Program.cs` (`AddHandlersFromAssembly` + `AddValidatorsFromAssembly` for the Application assembly — confirm whether already present; GIS registers handlers via `AddHandlersFromAssembly(typeof(SomeCommand).Assembly)`)
- Test: `tests/…UnitTests/Application/AssetLifecycleCommandHandlerTests.cs`

> The four status commands share one shape: load aggregate (404 if missing), call the matching domain method with `changedBy` from request context, save, return id. Reason is optional. `UpdateAssetTechnicalProfile` carries the profile fields.

- [ ] **Step 1: Write failing handler tests** (mock `INetworkAssetRepository`, `ITenantContextAccessor`, `IRequestContextProvider` — mirror how GIS handler tests construct these; use NSubstitute which the UnitTests csproj already references):
```csharp
using FluentAssertions;
using NSubstitute;
using WaterNetwork.Asset.Application.Commands;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Asset.UnitTests.Application;

public class AssetLifecycleCommandHandlerTests
{
    private readonly INetworkAssetRepository _repo = Substitute.For<INetworkAssetRepository>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();
    private readonly IRequestContextProvider _ctx = Substitute.For<IRequestContextProvider>();

    public AssetLifecycleCommandHandlerTests()
    {
        _tenant.Current.Returns(new TenantContext("tenant-1", null, null));
        _ctx.Current().Returns(new RequestContext("corr-1", UserId: "user-7"));
    }

    private NetworkAsset Active(string id = "node-1") =>
        NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, "ND-001");

    [Fact]
    public async Task Suspend_Loads_Mutates_Saves()
    {
        var asset = Active(); _repo.GetByIdAsync("node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx);

        var id = await handler.HandleAsync(new SuspendAssetCommand("node-1", "win"), CancellationToken.None);

        id.Should().Be("node-1");
        asset.Status.Should().Be(AssetStatus.Suspended);
        await _repo.Received(1).SaveAsync(asset, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Command_On_Missing_Asset_Throws_NotFound()
    {
        _repo.GetByIdAsync("nope", Arg.Any<CancellationToken>()).Returns((NetworkAsset?)null);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx);
        await handler.Invoking(h => h.HandleAsync(new SuspendAssetCommand("nope", null), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
    }

    [Fact]
    public async Task Invalid_Transition_Propagates_BusinessRuleException()
    {
        var asset = Active(); asset.Suspend("u", null);           // now Suspended
        _repo.GetByIdAsync("node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx);   // Suspend again → invalid
        await handler.Invoking(h => h.HandleAsync(new SuspendAssetCommand("node-1", null), CancellationToken.None))
            .Should().ThrowAsync<BusinessRuleException>();
    }
}
```
(Add equivalent happy-path facts for Activate/MarkAsMaintenance/Decommission/UpdateTechnicalProfile as you implement each — same arrange/act/assert.)

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement the commands + handlers**

`SuspendAssetCommand.cs` (the other three status commands are identical in shape — repeat, don't share):
```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;
namespace WaterNetwork.Asset.Application.Commands;
public sealed record SuspendAssetCommand(string AssetId, string? Reason) : ICommand<string>;
```
`SuspendAssetCommandHandler.cs`:
```csharp
using WaterNetwork.Asset.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Asset.Application.Commands;

public sealed class SuspendAssetCommandHandler(
    INetworkAssetRepository repository, ITenantContextAccessor tenantAccessor, IRequestContextProvider ctx)
    : ICommandHandler<SuspendAssetCommand, string>
{
    public async Task<string> HandleAsync(SuspendAssetCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        var asset = await repository.GetByIdAsync(command.AssetId, ct)
            ?? throw NotFoundException.Entity("NetworkAsset", command.AssetId);
        var changedBy = ctx.Current()?.UserId ?? tenant.TenantId;
        asset.Suspend(changedBy, command.Reason);
        await repository.SaveAsync(asset, ct);
        return asset.Id;
    }
}
```
Repeat for `ActivateAssetCommand`→`asset.Activate`, `MarkAssetAsMaintenanceCommand`→`asset.MarkAsMaintenance`, `DecommissionAssetCommand(AssetId, Reason)`→`asset.Decommission`. For `UpdateAssetTechnicalProfileCommand`:
```csharp
public sealed record UpdateAssetTechnicalProfileCommand(
    string AssetId, int? InstallationYear, string? Manufacturer, string? Model,
    IReadOnlyDictionary<string, string?> Attributes) : ICommand<string>;
```
Handler calls `asset.UpdateTechnicalProfile(changedBy, command.InstallationYear, command.Manufacturer, command.Model, command.Attributes)`.

Validators (FluentValidation, mirror GIS `…Validators/RelocateNodeCommandValidator.cs`): e.g. `UpdateAssetTechnicalProfileCommandValidator` — `InstallationYear` when present must be 1900–2100 (defense-in-depth; the domain also guards); `Manufacturer`/`Model` max length 128. The status commands need no validator beyond a non-empty `AssetId` (route-supplied) — add a minimal validator only if you add request-body validation; otherwise skip.

Register in `Program.cs` (confirm the asset Program already calls these for the Application assembly; if not, add):
```csharp
builder.Services.AddHandlersFromAssembly(typeof(WaterNetwork.Asset.Application.Commands.SuspendAssetCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(WaterNetwork.Asset.Application.Commands.SuspendAssetCommand).Assembly);
```

- [ ] **Step 4: Run → GREEN.** Build → 0 warnings.

- [ ] **Step 5: Commit**
```bash
git add src/services/water-network-asset-be
git commit -m "feat(asset): lifecycle + technical-profile commands, handlers, validators (AST-2)"
```

---

### Task 7: Read side + HTTP endpoints (`/api/assets`)

**Files:**
- Create: `…/Application/Dtos/{AssetDetailDto,AssetSummaryDto,AssetLifecycleEntryDto,AssetTechnicalProfileDto}.cs`
- Create: `…/Application/Queries/{GetAssetDetailQuery,GetAssetDetailQueryHandler,GetAssetsQuery,GetAssetsQueryHandler}.cs`
- Create: `…/Application/Ports/IAssetReadDao.cs`; `…/Infrastructure/Repositories/AssetReadDao.cs` (Dapper — mirror GIS `NodeReadDao`)
- Create: `…/Contracts/Requests/{DecommissionAssetRequest,UpdateAssetTechnicalProfileRequest}.cs`
- Create: `…/Api/Endpoints/AssetsEndpointModule.cs`; `…/Api/Validators/UpdateAssetTechnicalProfileRequestValidator.cs`
- Modify: `…/Api/Program.cs` (register `IAssetReadDao`)
- Test: `tests/…IntegrationTests/AssetLifecycleApiTests.cs`

- [ ] **Step 1: Write failing API integration tests** (full HTTP round-trip via `AssetApiFactory` + an auth token; mirror GIS `…IntegrationTests/RemoveAndRelocateApiTests.cs` for how it builds an authenticated client with the Mock JWT + permissions):
```csharp
// Cover: seed an asset (via repository), then:
//  - POST /api/assets/{id}/suspend → 200/204; GET /api/assets/{id} shows Suspended + 2 lifecycle entries
//  - POST /api/assets/{id}/suspend again → 422 (BUSINESS_RULE / InvalidAssetTransition)
//  - POST /api/assets/{id}/decommission {reason} → terminal; subsequent POST activate → 422 AssetAlreadyDecommissioned
//  - PUT /api/assets/{id}/technical-profile {installationYear,...} → GET shows the profile
//  - GET /api/assets?status=Suspended&page=1 → paginated list contains the asset
//  - GET /api/assets/{unknown} → 404
// Assert status codes + JSON body (problem-details code on errors).
```
Write these as concrete `[Fact]`s using the factory's HttpClient. Use the same authenticated-client helper pattern as the GIS API tests (Mock JWT issues a token with the required permission). Required permissions: `network-asset:write` for the command endpoints, `network-asset:read` for the GETs.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement DTOs, queries, read DAO, request DTOs, endpoint module**

DTOs (records):
```csharp
public sealed record AssetSummaryDto(string Id, string AssetType, string AssetCode, string Status, DateTime UpdatedAt);
public sealed record AssetLifecycleEntryDto(string FromStatus, string ToStatus, string ActorId, string? Reason, DateTime OccurredAt);
public sealed record AssetTechnicalProfileDto(int? InstallationYear, string? Manufacturer, string? Model, IReadOnlyDictionary<string,string?> Attributes);
public sealed record AssetDetailDto(string Id, string TenantId, string AssetType, string AssetCode, string Status,
    DateTime CreatedAt, DateTime UpdatedAt, AssetTechnicalProfileDto? TechnicalProfile, IReadOnlyList<AssetLifecycleEntryDto> LifecycleHistory);
```
`IAssetReadDao` + Dapper `AssetReadDao` (mirror `NodeReadDao`'s use of `IReadDao`/`NpgsqlConnection`):
- `GetDetailAsync(tenantId, assetId)` → joins `network_assets` + `asset_technical_profiles` + `asset_lifecycle_entries` (ordered by `occurred_at`). Tenant-scoped.
- `GetPagedAsync(tenantId, type?, status?, page, pageSize)` → filtered, paginated summary list + total count.
Queries `GetAssetDetailQuery(AssetId) : IQuery<AssetDetailDto?>` and `GetAssetsQuery(Type?, Status?, Page, PageSize) : IQuery<PaginatedResult<AssetSummaryDto>>` with handlers that read tenant from `ITenantContextAccessor` and delegate to the DAO. Use the building-blocks pagination type (`…/WebApi/Http/PaginationDto.cs` — confirm its exact name/shape and reuse it; if it's a `PaginationDto`/`PagedResult<T>`, match it).

Request DTOs:
```csharp
public sealed record DecommissionAssetRequest(string? Reason);
public sealed record UpdateAssetTechnicalProfileRequest(int? InstallationYear, string? Manufacturer, string? Model,
    Dictionary<string, string?>? Attributes);
```
`AssetsEndpointModule` (mirror `NodesEndpointModule`; group `/api/assets`):
```csharp
var group = app.MapGroup("/api/assets");

group.MapPost("/{id}/activate", async (string id, ICommandBus bus, CancellationToken ct) =>
    { await bus.ExecuteAsync(new ActivateAssetCommand(id, null), ct); return Results.NoContent(); })
    .RequirePermission("network-asset:write");
group.MapPost("/{id}/maintenance", async (string id, ICommandBus bus, CancellationToken ct) =>
    { await bus.ExecuteAsync(new MarkAssetAsMaintenanceCommand(id, null), ct); return Results.NoContent(); })
    .RequirePermission("network-asset:write");
group.MapPost("/{id}/suspend", async (string id, ICommandBus bus, CancellationToken ct) =>
    { await bus.ExecuteAsync(new SuspendAssetCommand(id, null), ct); return Results.NoContent(); })
    .RequirePermission("network-asset:write");
group.MapPost("/{id}/decommission", async (string id, DecommissionAssetRequest req, ICommandBus bus, CancellationToken ct) =>
    { await bus.ExecuteAsync(new DecommissionAssetCommand(id, req.Reason), ct); return Results.NoContent(); })
    .RequirePermission("network-asset:write");
group.MapPut("/{id}/technical-profile", async (string id, UpdateAssetTechnicalProfileRequest req, ICommandBus bus, CancellationToken ct) =>
    {
        await bus.ExecuteAsync(new UpdateAssetTechnicalProfileCommand(id, req.InstallationYear, req.Manufacturer,
            req.Model, req.Attributes ?? new Dictionary<string, string?>()), ct);
        return Results.NoContent();
    })
    .WithValidation<UpdateAssetTechnicalProfileRequest>()
    .RequirePermission("network-asset:write");

group.MapGet("/{id}", async Task<Results<Ok<AssetDetailDto>, NotFound>> (string id, IQueryBus bus, CancellationToken ct) =>
    { var dto = await bus.ExecuteAsync(new GetAssetDetailQuery(id), ct); return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto); })
    .RequirePermission("network-asset:read");
group.MapGet("/", async (string? type, string? status, int page, int pageSize, IQueryBus bus, CancellationToken ct) =>
    { var result = await bus.ExecuteAsync(new GetAssetsQuery(type, status, page <= 0 ? 1 : page, pageSize <= 0 ? 20 : pageSize), ct); return Results.Ok(result); })
    .RequirePermission("network-asset:read");
```
Decide reason-in-body for activate/maintenance/suspend: AST-2 keeps them reason-less (pass `null`) for simplicity; decommission takes a reason body. (If product wants a reason on suspend, add a request DTO later — YAGNI now.)
Register the read DAO in `Program.cs`: `builder.Services.AddScoped<IAssetReadDao, AssetReadDao>();`

- [ ] **Step 4: Run → GREEN** (all API tests). Build → 0 warnings.

- [ ] **Step 5: Commit**
```bash
git add src/services/water-network-asset-be
git commit -m "feat(asset): /api/assets lifecycle endpoints + detail/list queries (AST-2)"
```

---

### Task 8: Decision 0012, event catalog, tracking ticks, final verification

**Files:**
- Create: `docs/decisions/0012-asset-lifecycle-event-taxonomy.md`
- Modify: `docs/conventions/event-catalog.md` (add the 3 new events), `docs/stories/backlog.md`, `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` (tick AST-2), commit this plan file
- Verify: full gate

- [ ] **Step 1: Decision 0012** — record the lifecycle event taxonomy decision (match the house style of `docs/decisions/0011-…md`): `asset.status.changed` is the single universal transition signal (emitted on every transition, the GIS-5 input); `asset.decommissioned` adds reason/actor on the terminal transition; `asset.technical-profile.updated` excludes loose attributes (queryable via GET); `asset.activated`/`asset.maintenance-marked` are **deferred** (no Phase-1 consumer) — add when a consumer needs the semantic distinction. Note the multi-event version-bookkeeping rule (decommission bumps Version by 2).

- [ ] **Step 2: Event catalog** — add rows to `docs/conventions/event-catalog.md`: `asset.status.changed` (producer asset-be; consumers: GIS-5 [planned], maintenance/observation [future]; payload `AssetStatusChangedV1`), `asset.decommissioned` (`AssetDecommissionedV1`), `asset.technical-profile.updated` (`AssetTechnicalProfileUpdatedV1`) — all shipped AST-2.

- [ ] **Step 3: Tracking** — `backlog.md`: Phase 1 row note AST-2 done; add a "Follow-up sau AST-2" section (deferred `asset.activated`/`asset.maintenance-marked`; reason-on-suspend if product needs it; ownership/master-data port is AST-3). Roadmap §3.3 + §5.4: tick AST-2 ✓. Commit this plan file (`2026-06-15-phase1-ast2-lifecycle-commands.md`).

- [ ] **Step 4: Verification gate** (run each test project — `.slnx` test runs 0 tests):
```bash
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests/WaterNetwork.Asset.UnitTests.csproj
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.ContractTests/WaterNetwork.Asset.ContractTests.csproj
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/WaterNetwork.Asset.IntegrationTests.csproj
dotnet build src/services/water-network-asset-be/WaterNetwork.Asset.slnx -warnaserror
dotnet build WaterPlatform.BuildingBlocks.slnx
```
All green / 0 warnings (asset Unit + Contract + Integration; asset solution `-warnaserror`; building-blocks unaffected).

- [ ] **Step 5: Commit**
```bash
git add docs
git commit -m "docs(asset): decision 0012 event taxonomy, event catalog, tracking ticks (AST-2)"
```

---

## Self-Review (plan author)

**Spec coverage (roadmap §5.2/§5.3/§5.4 AST-2):**
- State machine TDD with full valid/invalid matrix → Task 1. ✓
- 5 commands (`ActivateAsset`, `MarkAssetAsMaintenance`, `SuspendAsset`, `DecommissionAsset`, `UpdateAssetTechnicalProfile`) → Tasks 1–2 (domain) + Task 6 (app). ✓
- Endpoints `POST /{id}/activate|maintenance|suspend|decommission`, `PUT /{id}/technical-profile` → Task 7 (path is `/api/assets/...` per decision 0009, not `/api/v1/...`). ✓
- Queries `GET /{id}` (with lifecycle history) + `GET /?type=&status=&page=` → Task 7. ✓
- `asset.status.changed` v1 `{assetId, assetType, previousStatus, newStatus, reason, changedBy}` chốt + contract-test first → Task 3. ✓
- `AssetTechnicalProfile` (jsonb loose attrs + hard cols) → Tasks 2, 5. ✓
- `DecommissioningRecord {reason, actorId}` → stored as `DecommissionReason`/`DecommissionedBy` columns (Tasks 1, 5). ✓
- Terminal `Decommissioned` → 422 `AssetAlreadyDecommissioned` → Task 1 (`BusinessRuleException`→422 verified). ✓
- `TransferAssetOwnership` / ownership — **explicitly out of scope** (roadmap puts it in AST-3). Not built here.
- Deferred `asset.activated`/`asset.maintenance-marked` — confirmed with user; recorded in decision 0012 (Task 8). ✓

**Placeholder scan:** No TBD/"add validation"-style placeholders; each step carries real code or a precise mirror reference (Dapper DAO SQL + GIS auth-client test helper are referenced to concrete GIS files rather than reproduced, consistent with how AST-1 referenced reference files for boilerplate).

**Type consistency:** `NetworkAsset.{Activate,MarkAsMaintenance,Suspend,Decommission}(changedBy, reason)` and `UpdateTechnicalProfile(changedBy, installationYear, manufacturer, model, attributes)` used identically in domain (Tasks 1–2), handlers (Task 6), and persistence (Task 5). `Reconstitute(… , decommissionReason, decommissionedBy, technicalProfile)` final param order is consistent between Tasks 1, 2, and 5's `ToDomain`. Domain event type-name strings (`AssetStatusChanged`/`AssetDecommissioned`/`AssetTechnicalProfileUpdated`) match the mapper registry keys (Task 4) and the outbox type-resolver (same assembly, already registered). Contract record names (`AssetStatusChangedV1` etc.) match the integration-event `Data` types (Task 4) and the catalog (Task 8). The multi-event version rule (decommission Version += 2) is stated in the Background, tested in Task 1, and exercised by the persistence test in Task 5.

**One known sharp edge flagged for the implementer:** the update-path lifecycle append uses `aggregate.LifecycleEntries.Skip(existing.LifecycleEntries.Count)` — correct because entries are append-only and never reordered; a repository test in Task 5 asserts exactly 2 entries after one transition to catch any regression.
