# INC-1 Report/Classify Incident Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Scaffold the new `water-network-incident-be` service and ship the incident reporting slice: `ReportIncident` / `ClassifyIncident` / `CancelIncident` with an append-only timeline, list/detail queries, GIS-ref verification (warning, not blocking), and the `incident.reported` / `incident.classified` / `incident.cancelled` integration events.

**Architecture:** Clean architecture across 5 projects (Contracts / Domain / Application / Infrastructure / Api), mirroring `water-network-design-be`. `NetworkIncident` is an event-sourcing-flavoured aggregate (factory + reconstitute, guarded transitions raising domain events). Domain events → outbox → MassTransit integration events via an `IIntegrationEventMapper`. Reads use Dapper DAOs; writes use an `AggregateRepositoryBase` subclass with transactional outbox. Affected asset refs are validated against GIS through `IGisLookupPort` (stub adapter for INC-1); a failed lookup marks the ref `unverified` rather than rejecting the incident.

**Tech Stack:** .NET 10, EF Core + Npgsql + NetTopologySuite (PostGIS), Dapper, FluentValidation, MassTransit (RabbitMQ / InMemory for tests), xUnit + FluentAssertions + Testcontainers (`PostgisFixture`).

**Scope decisions (confirmed with user 2026-06-17):**
- **State enum = INC-1 subset only:** `Reported`, `Classified`, `Cancelled`. The full machine (`IsolationRequested … Resolved`) is added in INC-2/INC-3 (YAGNI — no dead states without handlers).
- **GIS ref verification wired now:** `IGisLookupPort` + `StubGisLookupAdapter` (config-driven). Missing ref ⇒ stored with `verified=false` (the `unverifiedAssetRef` rule from roadmap §9.2 / US-P3-03). Never blocks creation.
- **Routes:** `/api/incidents` (no `/v1/` segment — decision 0009; read roadmap's `/api/v1/incidents` through it).
- **Cross-tenant:** mutation handlers load via tenant check and 404 on mismatch (decision 0016).

**Reference conventions:** `water-network-design-be` is the closest existing service — copy its project layout, `PlatformDbContext`/`AggregateRepositoryBase`/`AddPlatform*` wiring, endpoint-module + integration-test patterns. Building blocks live under `src/building-blocks/src/WaterPlatform.BuildingBlocks.*`.

---

## File Structure

```
src/services/water-network-incident-be/
├── WaterNetwork.Incident.slnx
├── Dockerfile
├── src/
│   ├── WaterNetwork.Incident.Contracts/          # integration-event payloads + event-type constants
│   │   ├── IncidentEventTypes.cs
│   │   └── Events/{IncidentReportedV1,IncidentClassifiedV1,IncidentCancelledV1,AffectedAssetRefV1}.cs
│   ├── WaterNetwork.Incident.Domain/
│   │   ├── ValueObjects/{IncidentCategory,IncidentStatus,AssetRefKind,AssetRef,TimelineEntryType}.cs
│   │   ├── Entities/IncidentTimelineEntry.cs
│   │   ├── Aggregates/NetworkIncident.cs
│   │   └── DomainEvents/{IncidentReported,IncidentClassified,IncidentCancelled}.cs
│   │   └── Repositories/INetworkIncidentRepository.cs
│   ├── WaterNetwork.Incident.Application/
│   │   ├── Ports/{IGisLookupPort,IIncidentReadDao}.cs
│   │   ├── Dtos/{IncidentDetailDto,IncidentSummaryDto,AffectedAssetDto,TimelineEntryDto}.cs
│   │   ├── Commands/{ReportIncident,ClassifyIncident,CancelIncident}{Command,CommandHandler}.cs
│   │   ├── Validators/{ReportIncident,ClassifyIncident,CancelIncident}CommandValidator.cs
│   │   └── Queries/{GetIncidentDetail,ListIncidents}{Query,QueryHandler}.cs
│   ├── WaterNetwork.Incident.Infrastructure/
│   │   ├── Persistence/IncidentDbContext.cs
│   │   ├── Persistence/DesignTimeIncidentDbContextFactory.cs
│   │   ├── Persistence/Models/{NetworkIncidentPersistenceModel,IncidentTimelineEntryModel,IncidentAffectedAssetModel}.cs
│   │   ├── Persistence/Configurations/{NetworkIncident,IncidentTimelineEntry,IncidentAffectedAsset}Configuration.cs
│   │   ├── Persistence/Migrations/*                 # generated
│   │   ├── Repositories/{NetworkIncidentRepository,IncidentReadDao}.cs
│   │   ├── GisLookup/{IGisLookupPort impl} StubGisLookupAdapter.cs + GisLookupOptions.cs
│   │   └── IntegrationEvents/IncidentIntegrationEventMapper.cs
│   └── WaterNetwork.Incident.Api/
│       ├── Program.cs
│       ├── appsettings.json
│       ├── Endpoints/IncidentsEndpointModule.cs
│       └── Requests/{ReportIncidentRequest,ClassifyIncidentRequest,CancelIncidentRequest}.cs
└── tests/
    ├── WaterNetwork.Incident.UnitTests/{NetworkIncidentTests,ReportIncidentHandlerTests}.cs
    ├── WaterNetwork.Incident.IntegrationTests/{IncidentApiFactory,CollectionFixtures,IncidentApiTests}.cs
    └── WaterNetwork.Incident.ContractTests/IncidentEventsContractTests.cs
```

Plus repo-level edits: `scripts/init-databases.sql` (add `wn_incident`), `docker-compose.yml` (service entry), `docs/conventions/event-catalog.md` (3 new events), `docs/decisions/0021-incident-report-contract.md` (new), `docs/stories/backlog.md` + roadmap checkbox.

---

## Task 0: Decision record 0021 — incident contract & state machine

**Files:**
- Create: `docs/decisions/0021-incident-report-contract.md`

- [x] **Step 1: Write the decision record**

```markdown
# 0021 Incident Reporting Contract & State Machine (INC-1)

Date: 2026-06-17

## Status

Accepted

## Context

INC-1 introduces `water-network-incident-be`, the first incident workflow slice
(US-P3-03). It must report/classify/cancel incidents and emit integration events
that later phases (INC-2 isolation, INC-3 confirm, Phase 4 maintenance, Phase 7
customer-impact) consume. Two questions need a durable answer now: (1) how wide
is the state machine in INC-1, and (2) how are affected asset references handled
when GIS cannot confirm them.

## Decision

- **State enum is the INC-1 subset only:** `Reported`, `Classified`, `Cancelled`.
  The full machine (`IsolationRequested → IsolationPlanReady → PlanConfirmed →
  HandlingStarted → Resolved`) is added incrementally in INC-2/INC-3 alongside
  the handlers that drive those transitions. No state exists without a transition
  that reaches it.
- **Transitions:** `Reported → Classified` (re-classify allowed: `Classified →
  Classified`), and `{Reported, Classified} → Cancelled`. `Cancelled` is terminal.
  Cancel requires a reason.
- **Affected asset refs are advisory in INC-1.** Each ref is `{assetId, kind}`
  (kind ∈ Node/Pipe/Device). On report, each ref is checked via `IGisLookupPort`;
  a ref GIS cannot confirm is stored with `verified=false` (surfaced as
  `unverified`) — it never blocks creation. INC-1 ships a config-driven stub
  adapter; a real GIS HTTP/gRPC adapter swaps in later via `GisLookup:Provider`.
- **Events (all v1):** `incident.reported`, `incident.classified`,
  `incident.cancelled`. Payloads carry `tenantId` explicitly (unlike GIS outbox
  events) so downstream consumers need not infer tenant from the envelope.
- **Routes:** `/api/incidents` (no version segment — decision 0009).
- **Cross-tenant:** mutation handlers load tenant-scoped and 404 on mismatch
  (decision 0016).

## Consequences

- INC-2 extends the enum + adds `RequestIsolationAnalysis` and the gRPC topology
  port; INC-3 adds confirm/handle/resolve and the `maintenance.work-order-requested`
  contract.
- `unverified` refs may later be re-resolved when INC-2 wires the real GIS lookup.
- Severity is an integer 1–4 (1 = lowest), guarded in the domain and at the API
  boundary. Category enum: `PipeBurst`, `PressureDrop`, `WaterLoss`, `Leak`, `Other`.
```

- [x] **Step 2: Commit**

```bash
git add docs/decisions/0021-incident-report-contract.md
git commit -m "docs(incident): INC-1 decision 0021 — incident report contract + state machine (INC-1)"
```

---

## Task 1: Scaffold projects, solution, database

**Files:**
- Create: 5 src `.csproj` + 3 test `.csproj` under `src/services/water-network-incident-be/`
- Create: `src/services/water-network-incident-be/WaterNetwork.Incident.slnx`
- Modify: `scripts/init-databases.sql`

- [x] **Step 1: Create the five source project files**

`src/services/water-network-incident-be/src/WaterNetwork.Incident.Contracts/WaterNetwork.Incident.Contracts.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

`src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/WaterNetwork.Incident.Domain.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Domain/WaterPlatform.BuildingBlocks.Domain.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="NetTopologySuite" />
  </ItemGroup>
</Project>
```

`src/services/water-network-incident-be/src/WaterNetwork.Incident.Application/WaterNetwork.Incident.Application.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Incident.Domain/WaterNetwork.Incident.Domain.csproj" />
    <ProjectReference Include="../WaterNetwork.Incident.Contracts/WaterNetwork.Incident.Contracts.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Application/WaterPlatform.BuildingBlocks.Application.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.MultiTenancy/WaterPlatform.BuildingBlocks.MultiTenancy.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="FluentValidation" />
    <PackageReference Include="NetTopologySuite" />
  </ItemGroup>
</Project>
```

`src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure/WaterNetwork.Incident.Infrastructure.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <NoWarn>$(NoWarn);CA1861</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Incident.Application/WaterNetwork.Incident.Application.csproj" />
    <ProjectReference Include="../WaterNetwork.Incident.Domain/WaterNetwork.Incident.Domain.csproj" />
    <ProjectReference Include="../WaterNetwork.Incident.Contracts/WaterNetwork.Incident.Contracts.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Infrastructure/WaterPlatform.BuildingBlocks.Infrastructure.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.EventBus/WaterPlatform.BuildingBlocks.EventBus.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Dapper" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" />
    <PackageReference Include="NetTopologySuite" />
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite" />
  </ItemGroup>
</Project>
```

`src/services/water-network-incident-be/src/WaterNetwork.Incident.Api/WaterNetwork.Incident.Api.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Incident.Application/WaterNetwork.Incident.Application.csproj" />
    <ProjectReference Include="../WaterNetwork.Incident.Infrastructure/WaterNetwork.Incident.Infrastructure.csproj" />
    <ProjectReference Include="../WaterNetwork.Incident.Contracts/WaterNetwork.Incident.Contracts.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.WebApi/WaterPlatform.BuildingBlocks.WebApi.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>
</Project>
```

- [x] **Step 2: Create the three test project files**

`src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/WaterNetwork.Incident.Application/WaterNetwork.Incident.Application.csproj" />
    <ProjectReference Include="../../src/WaterNetwork.Incident.Infrastructure/WaterNetwork.Incident.Infrastructure.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="NSubstitute" />
  </ItemGroup>
</Project>
```

`src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests/WaterNetwork.Incident.ContractTests.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/WaterNetwork.Incident.Contracts/WaterNetwork.Incident.Contracts.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
  </ItemGroup>
</Project>
```

`src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/WaterNetwork.Incident.Api/WaterNetwork.Incident.Api.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Testing/WaterPlatform.BuildingBlocks.Testing.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Security/WaterPlatform.BuildingBlocks.Security.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
  </ItemGroup>
</Project>
```

> NOTE: confirm `NSubstitute` exists in `Directory.Packages.props`. If absent, check what mocking library the existing unit-test projects use (`grep -rl "using NSubstitute\|using Moq" src/services/*/tests`) and match it. If the design-be unit tests use plain hand-rolled fakes, do the same and drop the `NSubstitute` PackageReference.

- [x] **Step 3: Create the solution file**

`src/services/water-network-incident-be/WaterNetwork.Incident.slnx`:
```xml
<Solution>
  <Folder Name="/src/">
    <Project Path="src/WaterNetwork.Incident.Api/WaterNetwork.Incident.Api.csproj" />
    <Project Path="src/WaterNetwork.Incident.Application/WaterNetwork.Incident.Application.csproj" />
    <Project Path="src/WaterNetwork.Incident.Contracts/WaterNetwork.Incident.Contracts.csproj" />
    <Project Path="src/WaterNetwork.Incident.Domain/WaterNetwork.Incident.Domain.csproj" />
    <Project Path="src/WaterNetwork.Incident.Infrastructure/WaterNetwork.Incident.Infrastructure.csproj" />
  </Folder>
  <Folder Name="/tests/">
    <Project Path="tests/WaterNetwork.Incident.ContractTests/WaterNetwork.Incident.ContractTests.csproj" />
    <Project Path="tests/WaterNetwork.Incident.IntegrationTests/WaterNetwork.Incident.IntegrationTests.csproj" />
    <Project Path="tests/WaterNetwork.Incident.UnitTests/WaterNetwork.Incident.UnitTests.csproj" />
  </Folder>
</Solution>
```

> Compare against `src/services/water-network-design-be/WaterNetwork.Design.slnx` and match its folder layout exactly if it differs.

- [x] **Step 4: Add the database to the init script**

In `scripts/init-databases.sql`, add after the `CREATE DATABASE wn_design;` line:
```sql
CREATE DATABASE wn_incident;
```

- [x] **Step 5: Verify the solution builds (empty projects)**

Run: `dotnet build src/services/water-network-incident-be/WaterNetwork.Incident.slnx`
Expected: PASS — `Build succeeded. 0 Warning(s) 0 Error(s)`. (No source files yet; just project graph + package restore.)

- [x] **Step 6: Commit**

```bash
git add src/services/water-network-incident-be scripts/init-databases.sql
git commit -m "feat(incident): INC-1 scaffold incident-be projects + solution + wn_incident db (INC-1)"
```

---

## Task 2: Domain value objects

**Files:**
- Create: `src/.../Domain/ValueObjects/IncidentCategory.cs`
- Create: `src/.../Domain/ValueObjects/IncidentStatus.cs`
- Create: `src/.../Domain/ValueObjects/AssetRefKind.cs`
- Create: `src/.../Domain/ValueObjects/TimelineEntryType.cs`
- Create: `src/.../Domain/ValueObjects/AssetRef.cs`
- Test: `tests/WaterNetwork.Incident.UnitTests/AssetRefTests.cs`

(Path prefix `src/.../Domain` = `src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain`.)

- [x] **Step 1: Write the failing test for AssetRef**

`tests/WaterNetwork.Incident.UnitTests/AssetRefTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.UnitTests;

public sealed class AssetRefTests
{
    [Fact]
    public void Verified_Factory_Sets_Flag_True()
    {
        var r = AssetRef.Create("asset-1", AssetRefKind.Pipe, verified: true);
        r.AssetId.Should().Be("asset-1");
        r.Kind.Should().Be(AssetRefKind.Pipe);
        r.Verified.Should().BeTrue();
    }

    [Fact]
    public void Blank_AssetId_Throws()
    {
        var act = () => AssetRef.Create("  ", AssetRefKind.Node, verified: false);
        act.Should().Throw<ArgumentException>();
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests --filter AssetRefTests`
Expected: FAIL — `AssetRef`/`AssetRefKind` do not exist (compile error).

- [x] **Step 3: Write the value objects**

`ValueObjects/IncidentCategory.cs`:
```csharp
namespace WaterNetwork.Incident.Domain.ValueObjects;

public enum IncidentCategory
{
    PipeBurst,
    PressureDrop,
    WaterLoss,
    Leak,
    Other
}
```

`ValueObjects/IncidentStatus.cs`:
```csharp
namespace WaterNetwork.Incident.Domain.ValueObjects;

// INC-1 subset only (decision 0021). INC-2/INC-3 extend this enum.
public enum IncidentStatus
{
    Reported,
    Classified,
    Cancelled
}
```

`ValueObjects/AssetRefKind.cs`:
```csharp
namespace WaterNetwork.Incident.Domain.ValueObjects;

public enum AssetRefKind
{
    Node,
    Pipe,
    Device
}
```

`ValueObjects/TimelineEntryType.cs`:
```csharp
namespace WaterNetwork.Incident.Domain.ValueObjects;

public enum TimelineEntryType
{
    Reported,
    Classified,
    Cancelled
}
```

`ValueObjects/AssetRef.cs`:
```csharp
namespace WaterNetwork.Incident.Domain.ValueObjects;

/// <summary>A reference to a GIS asset affected by an incident. <see cref="Verified"/> is false
/// when GIS could not confirm the ref existed at report time (decision 0021 — advisory, not blocking).</summary>
public sealed record AssetRef
{
    public string AssetId { get; }
    public AssetRefKind Kind { get; }
    public bool Verified { get; }

    private AssetRef(string assetId, AssetRefKind kind, bool verified)
    {
        AssetId = assetId;
        Kind = kind;
        Verified = verified;
    }

    public static AssetRef Create(string assetId, AssetRefKind kind, bool verified)
    {
        if (string.IsNullOrWhiteSpace(assetId))
            throw new ArgumentException("Asset ref id is required.", nameof(assetId));
        return new AssetRef(assetId.Trim(), kind, verified);
    }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests --filter AssetRefTests`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain/ValueObjects \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/AssetRefTests.cs
git commit -m "feat(incident): INC-1 domain value objects (category/status/asset-ref) (INC-1)"
```

---

## Task 3: NetworkIncident aggregate + timeline entry + domain events

**Files:**
- Create: `src/.../Domain/Entities/IncidentTimelineEntry.cs`
- Create: `src/.../Domain/DomainEvents/IncidentReported.cs`
- Create: `src/.../Domain/DomainEvents/IncidentClassified.cs`
- Create: `src/.../Domain/DomainEvents/IncidentCancelled.cs`
- Create: `src/.../Domain/Aggregates/NetworkIncident.cs`
- Create: `src/.../Domain/Repositories/INetworkIncidentRepository.cs`
- Test: `tests/WaterNetwork.Incident.UnitTests/NetworkIncidentTests.cs`

- [x] **Step 1: Write the failing aggregate tests**

`tests/WaterNetwork.Incident.UnitTests/NetworkIncidentTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.DomainEvents;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Incident.UnitTests;

public sealed class NetworkIncidentTests
{
    private static NetworkIncident Reported() => NetworkIncident.Report(
        tenantId: "tenant-1",
        category: IncidentCategory.PipeBurst,
        severity: 3,
        longitude: 106.7,
        latitude: 10.8,
        affectedRefs: new[] { AssetRef.Create("pipe-1", AssetRefKind.Pipe, verified: true) },
        reportedBy: "operator-1");

    [Fact]
    public void Report_Starts_In_Reported_And_Raises_Event_And_Timeline()
    {
        var incident = Reported();

        incident.Status.Should().Be(IncidentStatus.Reported);
        incident.Category.Should().Be(IncidentCategory.PipeBurst);
        incident.Severity.Should().Be(3);
        incident.AffectedRefs.Should().ContainSingle(r => r.AssetId == "pipe-1");
        incident.TimelineEntries.Should().ContainSingle(t => t.EntryType == TimelineEntryType.Reported);
        incident.GetDomainEvents().Should().ContainSingle(e => e is IncidentReported);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    public void Report_With_Severity_Out_Of_Range_Throws(int severity)
    {
        var act = () => NetworkIncident.Report("tenant-1", IncidentCategory.Leak, severity,
            longitude: null, latitude: null, affectedRefs: Array.Empty<AssetRef>(), reportedBy: "op");
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void Classify_From_Reported_Moves_To_Classified_And_Raises_Event()
    {
        var incident = Reported();
        incident.ClearDomainEvents();

        incident.Classify(IncidentCategory.Leak, severity: 2, actorId: "op-2", note: "reassessed");

        incident.Status.Should().Be(IncidentStatus.Classified);
        incident.Category.Should().Be(IncidentCategory.Leak);
        incident.Severity.Should().Be(2);
        incident.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.Classified);
        incident.GetDomainEvents().Should().ContainSingle(e => e is IncidentClassified);
    }

    [Fact]
    public void Cancel_Requires_Reason()
    {
        var incident = Reported();
        var act = () => incident.Cancel(reason: "  ", actorId: "op");
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void Cancel_From_Reported_Moves_To_Cancelled_And_Raises_Event()
    {
        var incident = Reported();
        incident.ClearDomainEvents();

        incident.Cancel(reason: "duplicate report", actorId: "op-3");

        incident.Status.Should().Be(IncidentStatus.Cancelled);
        incident.CancellationReason.Should().Be("duplicate report");
        incident.GetDomainEvents().Should().ContainSingle(e => e is IncidentCancelled);
    }

    [Fact]
    public void Classify_After_Cancel_Throws()
    {
        var incident = Reported();
        incident.Cancel("cancelled", "op");
        var act = () => incident.Classify(IncidentCategory.Other, 1, "op", note: null);
        act.Should().Throw<BusinessRuleException>();
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests --filter NetworkIncidentTests`
Expected: FAIL — `NetworkIncident`/events do not exist (compile error).

- [x] **Step 3: Write the timeline entry entity**

`Entities/IncidentTimelineEntry.cs`:
```csharp
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Domain.Entities;

/// <summary>Append-only audit entry on an incident's timeline.</summary>
public sealed record IncidentTimelineEntry(
    string Id,
    TimelineEntryType EntryType,
    string ActorId,
    string? Note,
    DateTime OccurredAt,
    int Sequence)
{
    public static IncidentTimelineEntry Create(TimelineEntryType type, string actorId, string? note, int sequence)
        => new(Guid.CreateVersion7().ToString(), type, actorId, note, DateTime.UtcNow, sequence);
}
```

- [x] **Step 4: Write the domain events**

`DomainEvents/IncidentReported.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentReportedAssetRefData(string AssetId, string Kind, bool Verified);

public sealed record IncidentReportedData(
    string TenantId,
    string Category,
    int Severity,
    double? Longitude,
    double? Latitude,
    IReadOnlyList<IncidentReportedAssetRefData> AffectedRefs,
    string ReportedBy);

public sealed record IncidentReported(string AggregateId, IncidentReportedData Data)
    : DomainEventBase<IncidentReportedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentReported",
        data: Data);
```

`DomainEvents/IncidentClassified.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentClassifiedData(
    string TenantId,
    string Category,
    int Severity,
    string ActorId,
    string? Note);

public sealed record IncidentClassified(string AggregateId, IncidentClassifiedData Data)
    : DomainEventBase<IncidentClassifiedData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentClassified",
        data: Data);
```

`DomainEvents/IncidentCancelled.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Incident.Domain.DomainEvents;

public sealed record IncidentCancelledData(
    string TenantId,
    string Reason,
    string ActorId);

public sealed record IncidentCancelled(string AggregateId, IncidentCancelledData Data)
    : DomainEventBase<IncidentCancelledData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkIncident",
        eventType: "IncidentCancelled",
        data: Data);
```

- [x] **Step 5: Write the aggregate**

`Aggregates/NetworkIncident.cs`:
```csharp
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
        if (Status == IncidentStatus.Cancelled)
            throw BusinessRuleException.Violation("InvalidIncidentTransition",
                "[InvalidIncidentTransition] Incident is already cancelled.");
        if (string.IsNullOrWhiteSpace(reason))
            throw BusinessRuleException.Violation("CancellationReasonRequired",
                "[CancellationReasonRequired] A reason is required to cancel an incident.");

        Status = IncidentStatus.Cancelled;
        CancellationReason = reason.Trim();
        AppendTimeline(TimelineEntryType.Cancelled, actorId, reason.Trim());
        MarkAsModified();
        AddDomainEvent(new IncidentCancelled(Id, new IncidentCancelledData(TenantId, reason.Trim(), actorId)));
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
        IEnumerable<AssetRef> affectedRefs, IEnumerable<IncidentTimelineEntry> timeline)
    {
        var incident = new NetworkIncident(id, tenantId, category, severity, longitude, latitude,
            status, reportedBy, cancellationReason, version, createdAt, updatedAt);
        incident._affectedRefs.AddRange(affectedRefs);
        incident._timeline.AddRange(timeline);
        return incident;
    }
}
```

> If `BusinessRuleException.Violation(string, string)` signature differs, confirm with `grep -n "public static BusinessRuleException Violation" src/building-blocks/src/WaterPlatform.BuildingBlocks.Domain/Exceptions/*.cs` and match. The design-be aggregate uses exactly `BusinessRuleException.Violation("InvalidRevisionTransition", "...")`.

- [x] **Step 6: Write the repository port**

`Repositories/INetworkIncidentRepository.cs`:
```csharp
using WaterNetwork.Incident.Domain.Aggregates;

namespace WaterNetwork.Incident.Domain.Repositories;

public interface INetworkIncidentRepository
{
    Task<NetworkIncident> SaveAsync(NetworkIncident incident, CancellationToken ct = default);
    Task<NetworkIncident?> GetByIdAsync(string id, CancellationToken ct = default);
}
```

- [x] **Step 7: Run tests to verify they pass**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests --filter NetworkIncidentTests`
Expected: PASS (7 tests).

- [x] **Step 8: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Domain \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/NetworkIncidentTests.cs
git commit -m "feat(incident): INC-1 NetworkIncident aggregate + timeline + domain events (INC-1)"
```

---

## Task 4: Contracts — integration-event payloads + event-type constants

**Files:**
- Create: `src/.../Contracts/IncidentEventTypes.cs`
- Create: `src/.../Contracts/Events/AffectedAssetRefV1.cs`
- Create: `src/.../Contracts/Events/IncidentReportedV1.cs`
- Create: `src/.../Contracts/Events/IncidentClassifiedV1.cs`
- Create: `src/.../Contracts/Events/IncidentCancelledV1.cs`
- Test: `tests/WaterNetwork.Incident.ContractTests/IncidentEventsContractTests.cs`

- [x] **Step 1: Write the failing contract test**

`tests/WaterNetwork.Incident.ContractTests/IncidentEventsContractTests.cs`:
```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Incident.Contracts;
using WaterNetwork.Incident.Contracts.Events;

namespace WaterNetwork.Incident.ContractTests;

public sealed class IncidentEventsContractTests
{
    [Fact]
    public void Event_Types_Are_Fixed()
    {
        IncidentEventTypes.Reported.Should().Be("incident.reported");
        IncidentEventTypes.Classified.Should().Be("incident.classified");
        IncidentEventTypes.Cancelled.Should().Be("incident.cancelled");
    }

    [Fact]
    public void IncidentReported_V1_Schema_Is_Stable()
    {
        var evt = new IncidentReportedV1(
            "inc-1", "tenant-1", "PipeBurst", 3, 106.7, 10.8,
            new[] { new AffectedAssetRefV1("pipe-1", "Pipe", true) }, "operator-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "Category", "Severity",
                "Longitude", "Latitude", "AffectedRefs", "ReportedBy");
    }

    [Fact]
    public void IncidentCancelled_V1_Schema_Is_Stable()
    {
        var evt = new IncidentCancelledV1("inc-1", "tenant-1", "duplicate", "op-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "Reason", "CancelledBy");
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests`
Expected: FAIL — types do not exist (compile error).

- [x] **Step 3: Write the contracts**

`Contracts/IncidentEventTypes.cs`:
```csharp
namespace WaterNetwork.Incident.Contracts;

public static class IncidentEventTypes
{
    public const string Reported = "incident.reported";
    public const string Classified = "incident.classified";
    public const string Cancelled = "incident.cancelled";
}
```

`Contracts/Events/AffectedAssetRefV1.cs`:
```csharp
namespace WaterNetwork.Incident.Contracts.Events;

public sealed record AffectedAssetRefV1(string AssetId, string Kind, bool Verified);
```

`Contracts/Events/IncidentReportedV1.cs`:
```csharp
namespace WaterNetwork.Incident.Contracts.Events;

public sealed record IncidentReportedV1(
    string IncidentId,
    string TenantId,
    string Category,
    int Severity,
    double? Longitude,
    double? Latitude,
    IReadOnlyList<AffectedAssetRefV1> AffectedRefs,
    string ReportedBy);
```

`Contracts/Events/IncidentClassifiedV1.cs`:
```csharp
namespace WaterNetwork.Incident.Contracts.Events;

public sealed record IncidentClassifiedV1(
    string IncidentId,
    string TenantId,
    string Category,
    int Severity,
    string ClassifiedBy,
    string? Note);
```

`Contracts/Events/IncidentCancelledV1.cs`:
```csharp
namespace WaterNetwork.Incident.Contracts.Events;

public sealed record IncidentCancelledV1(
    string IncidentId,
    string TenantId,
    string Reason,
    string CancelledBy);
```

- [x] **Step 4: Run test to verify it passes**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Contracts \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests
git commit -m "feat(incident): INC-1 integration-event contracts (reported/classified/cancelled v1) (INC-1)"
```

---

## Task 5: Application layer — ports, commands, queries, validators

**Files:**
- Create: `src/.../Application/Ports/IGisLookupPort.cs`
- Create: `src/.../Application/Ports/IIncidentReadDao.cs`
- Create: `src/.../Application/Dtos/{IncidentDetailDto,IncidentSummaryDto,AffectedAssetDto,TimelineEntryDto}.cs`
- Create: `src/.../Application/Commands/ReportIncidentCommand.cs` (+ handler)
- Create: `src/.../Application/Commands/ClassifyIncidentCommand.cs` (+ handler)
- Create: `src/.../Application/Commands/CancelIncidentCommand.cs` (+ handler)
- Create: `src/.../Application/Validators/{ReportIncident,ClassifyIncident,CancelIncident}CommandValidator.cs`
- Create: `src/.../Application/Queries/GetIncidentDetailQuery.cs` (+ handler)
- Create: `src/.../Application/Queries/ListIncidentsQuery.cs` (+ handler)
- Test: `tests/WaterNetwork.Incident.UnitTests/ReportIncidentHandlerTests.cs`

- [x] **Step 1: Write the ports**

`Application/Ports/IGisLookupPort.cs`:
```csharp
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Application.Ports;

/// <summary>Read-only check that an affected asset ref exists in GIS. INC-1 ships a stub adapter;
/// a real HTTP/gRPC adapter swaps in later via config (decision 0021).</summary>
public interface IGisLookupPort
{
    Task<bool> AssetRefExists(string tenantId, AssetRefKind kind, string assetId, CancellationToken ct = default);
}
```

`Application/Ports/IIncidentReadDao.cs`:
```csharp
using WaterNetwork.Incident.Application.Dtos;

namespace WaterNetwork.Incident.Application.Ports;

public interface IIncidentReadDao
{
    Task<IncidentDetailDto?> GetDetailAsync(string tenantId, string incidentId, CancellationToken ct = default);
    Task<IReadOnlyList<IncidentSummaryDto>> ListAsync(
        string tenantId, string? status, int? severity, CancellationToken ct = default);
}
```

- [x] **Step 2: Write the DTOs**

`Application/Dtos/AffectedAssetDto.cs`:
```csharp
namespace WaterNetwork.Incident.Application.Dtos;

public sealed record AffectedAssetDto(string AssetId, string Kind, bool Verified);
```

`Application/Dtos/TimelineEntryDto.cs`:
```csharp
namespace WaterNetwork.Incident.Application.Dtos;

public sealed record TimelineEntryDto(string EntryType, string ActorId, string? Note, DateTime OccurredAt, int Sequence);
```

`Application/Dtos/IncidentSummaryDto.cs`:
```csharp
namespace WaterNetwork.Incident.Application.Dtos;

public sealed record IncidentSummaryDto(
    string Id, string Category, int Severity, string Status, string ReportedBy,
    DateTime CreatedAt, DateTime UpdatedAt);
```

`Application/Dtos/IncidentDetailDto.cs`:
```csharp
namespace WaterNetwork.Incident.Application.Dtos;

public sealed record IncidentDetailDto(
    string Id, string TenantId, string Category, int Severity,
    double? Longitude, double? Latitude, string Status, string ReportedBy,
    string? CancellationReason, DateTime CreatedAt, DateTime UpdatedAt,
    IReadOnlyList<AffectedAssetDto> AffectedRefs,
    IReadOnlyList<TimelineEntryDto> Timeline);
```

- [x] **Step 3: Write the failing ReportIncident handler test**

`tests/WaterNetwork.Incident.UnitTests/ReportIncidentHandlerTests.cs`:
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

public sealed class ReportIncidentHandlerTests
{
    private readonly INetworkIncidentRepository _repo = Substitute.For<INetworkIncidentRepository>();
    private readonly IGisLookupPort _gis = Substitute.For<IGisLookupPort>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();
    private readonly IRequestContextProvider _ctx = Substitute.For<IRequestContextProvider>();

    public ReportIncidentHandlerTests()
    {
        _tenant.Current.Returns(new TenantContext("tenant-1"));
        _ctx.Current().Returns(new RequestContext("corr-1", UserId: "operator-1"));
        _repo.SaveAsync(Arg.Any<NetworkIncident>(), Arg.Any<CancellationToken>())
            .Returns(ci => Task.FromResult(ci.Arg<NetworkIncident>()));
    }

    private ReportIncidentCommandHandler Handler() => new(_repo, _gis, _tenant, _ctx);

    [Fact]
    public async Task Existing_Ref_Is_Marked_Verified()
    {
        _gis.AssetRefExists("tenant-1", AssetRefKind.Pipe, "pipe-1", Arg.Any<CancellationToken>())
            .Returns(true);
        var cmd = new ReportIncidentCommand(IncidentCategory.PipeBurst, 3, 106.7, 10.8,
            new[] { new ReportIncidentAssetRef("pipe-1", AssetRefKind.Pipe) });

        NetworkIncident? saved = null;
        await _repo.SaveAsync(Arg.Do<NetworkIncident>(i => saved = i), Arg.Any<CancellationToken>());

        var id = await Handler().HandleAsync(cmd, default);

        id.Should().NotBeNullOrEmpty();
        saved!.AffectedRefs.Should().ContainSingle(r => r.AssetId == "pipe-1" && r.Verified);
    }

    [Fact]
    public async Task Missing_Ref_Is_Stored_Unverified_Not_Rejected()
    {
        _gis.AssetRefExists("tenant-1", AssetRefKind.Node, "ghost", Arg.Any<CancellationToken>())
            .Returns(false);
        var cmd = new ReportIncidentCommand(IncidentCategory.Leak, 2, null, null,
            new[] { new ReportIncidentAssetRef("ghost", AssetRefKind.Node) });

        NetworkIncident? saved = null;
        await _repo.SaveAsync(Arg.Do<NetworkIncident>(i => saved = i), Arg.Any<CancellationToken>());

        var act = async () => await Handler().HandleAsync(cmd, default);

        await act.Should().NotThrowAsync();
        saved!.AffectedRefs.Should().ContainSingle(r => r.AssetId == "ghost" && !r.Verified);
    }

    [Fact]
    public async Task No_Tenant_Throws_Unauthorized()
    {
        _tenant.Current.Returns((ITenantContext?)null);
        var cmd = new ReportIncidentCommand(IncidentCategory.Other, 1, null, null, Array.Empty<ReportIncidentAssetRef>());
        var act = async () => await Handler().HandleAsync(cmd, default);
        await act.Should().ThrowAsync<UnauthorizedException>();
    }
}
```

> `TenantContext`/`ITenantContext` exact shape: confirm with `grep -rn "class TenantContext\|interface ITenantContext\b\|TenantContextAccessor" src/building-blocks/src/WaterPlatform.BuildingBlocks.MultiTenancy`. Adjust the `new TenantContext("tenant-1")` construction to match (design-be tests show `tenantAccessor.Current` returns an object with `.TenantId`).

- [x] **Step 4: Run test to verify it fails**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests --filter ReportIncidentHandlerTests`
Expected: FAIL — command/handler types do not exist.

- [x] **Step 5: Write the ReportIncident command + handler**

`Application/Commands/ReportIncidentCommand.cs`:
```csharp
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record ReportIncidentAssetRef(string AssetId, AssetRefKind Kind);

public sealed record ReportIncidentCommand(
    IncidentCategory Category,
    int Severity,
    double? Longitude,
    double? Latitude,
    IReadOnlyList<ReportIncidentAssetRef> AffectedRefs) : ICommand<string>;
```

`Application/Commands/ReportIncidentCommandHandler.cs`:
```csharp
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Commands;

public sealed class ReportIncidentCommandHandler(
    INetworkIncidentRepository repository,
    IGisLookupPort gisLookup,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<ReportIncidentCommand, string>
{
    public async Task<string> HandleAsync(ReportIncidentCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to report an incident.");
        var reportedBy = requestContextProvider.Current()?.UserId ?? "unknown";

        var refs = new List<AssetRef>(command.AffectedRefs.Count);
        foreach (var r in command.AffectedRefs)
        {
            var verified = await gisLookup.AssetRefExists(tenant.TenantId, r.Kind, r.AssetId, ct);
            refs.Add(AssetRef.Create(r.AssetId, r.Kind, verified));
        }

        var incident = NetworkIncident.Report(
            tenant.TenantId, command.Category, command.Severity,
            command.Longitude, command.Latitude, refs, reportedBy);

        await repository.SaveAsync(incident, ct);
        return incident.Id;
    }
}
```

- [x] **Step 6: Write the Classify + Cancel commands + handlers**

`Application/Commands/ClassifyIncidentCommand.cs`:
```csharp
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record ClassifyIncidentCommand(
    string IncidentId, IncidentCategory Category, int Severity, string? Note) : ICommand;
```

`Application/Commands/ClassifyIncidentCommandHandler.cs`:
```csharp
using WaterNetwork.Incident.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Commands;

public sealed class ClassifyIncidentCommandHandler(
    INetworkIncidentRepository repository,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<ClassifyIncidentCommand, Unit>
{
    public async Task<Unit> HandleAsync(ClassifyIncidentCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var incident = await repository.GetByIdAsync(command.IncidentId, ct);
        if (incident is null || incident.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("NetworkIncident", command.IncidentId);

        var actorId = requestContextProvider.Current()?.UserId ?? "unknown";
        incident.Classify(command.Category, command.Severity, actorId, command.Note);
        await repository.SaveAsync(incident, ct);
        return Unit.Value;
    }
}
```

`Application/Commands/CancelIncidentCommand.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Incident.Application.Commands;

public sealed record CancelIncidentCommand(string IncidentId, string Reason) : ICommand;
```

`Application/Commands/CancelIncidentCommandHandler.cs`:
```csharp
using WaterNetwork.Incident.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Commands;

public sealed class CancelIncidentCommandHandler(
    INetworkIncidentRepository repository,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<CancelIncidentCommand, Unit>
{
    public async Task<Unit> HandleAsync(CancelIncidentCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var incident = await repository.GetByIdAsync(command.IncidentId, ct);
        if (incident is null || incident.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("NetworkIncident", command.IncidentId);

        var actorId = requestContextProvider.Current()?.UserId ?? "unknown";
        incident.Cancel(command.Reason, actorId);
        await repository.SaveAsync(incident, ct);
        return Unit.Value;
    }
}
```

- [x] **Step 7: Write the validators**

`Application/Validators/ReportIncidentCommandValidator.cs`:
```csharp
using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class ReportIncidentCommandValidator : AbstractValidator<ReportIncidentCommand>
{
    public ReportIncidentCommandValidator()
    {
        RuleFor(x => x.Category).IsInEnum();
        RuleFor(x => x.Severity).InclusiveBetween(1, 4);
        RuleForEach(x => x.AffectedRefs).ChildRules(r =>
        {
            r.RuleFor(a => a.AssetId).NotEmpty().MaximumLength(64);
            r.RuleFor(a => a.Kind).IsInEnum();
        });
        // Longitude/latitude must be provided together and within WGS84 bounds when present.
        RuleFor(x => x).Must(x => x.Longitude.HasValue == x.Latitude.HasValue)
            .WithMessage("Longitude and latitude must be provided together.");
        When(x => x.Longitude.HasValue, () =>
        {
            RuleFor(x => x.Longitude!.Value).InclusiveBetween(-180, 180);
            RuleFor(x => x.Latitude!.Value).InclusiveBetween(-90, 90);
        });
    }
}
```

`Application/Validators/ClassifyIncidentCommandValidator.cs`:
```csharp
using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class ClassifyIncidentCommandValidator : AbstractValidator<ClassifyIncidentCommand>
{
    public ClassifyIncidentCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.Category).IsInEnum();
        RuleFor(x => x.Severity).InclusiveBetween(1, 4);
        RuleFor(x => x.Note).MaximumLength(1000);
    }
}
```

`Application/Validators/CancelIncidentCommandValidator.cs`:
```csharp
using FluentValidation;
using WaterNetwork.Incident.Application.Commands;

namespace WaterNetwork.Incident.Application.Validators;

public sealed class CancelIncidentCommandValidator : AbstractValidator<CancelIncidentCommand>
{
    public CancelIncidentCommandValidator()
    {
        RuleFor(x => x.IncidentId).NotEmpty().MaximumLength(64);
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(1000);
    }
}
```

- [x] **Step 8: Write the queries + handlers**

`Application/Queries/GetIncidentDetailQuery.cs`:
```csharp
using WaterNetwork.Incident.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Incident.Application.Queries;

public sealed record GetIncidentDetailQuery(string IncidentId) : IQuery<IncidentDetailDto?>;
```

`Application/Queries/GetIncidentDetailQueryHandler.cs`:
```csharp
using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Queries;

public sealed class GetIncidentDetailQueryHandler(
    IIncidentReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetIncidentDetailQuery, IncidentDetailDto?>
{
    public Task<IncidentDetailDto?> HandleAsync(GetIncidentDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.GetDetailAsync(tenant.TenantId, query.IncidentId, ct);
    }
}
```

`Application/Queries/ListIncidentsQuery.cs`:
```csharp
using WaterNetwork.Incident.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Incident.Application.Queries;

public sealed record ListIncidentsQuery(string? Status, int? Severity) : IQuery<IReadOnlyList<IncidentSummaryDto>>;
```

`Application/Queries/ListIncidentsQueryHandler.cs`:
```csharp
using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.Application.Queries;

public sealed class ListIncidentsQueryHandler(
    IIncidentReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<ListIncidentsQuery, IReadOnlyList<IncidentSummaryDto>>
{
    public Task<IReadOnlyList<IncidentSummaryDto>> HandleAsync(ListIncidentsQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.ListAsync(tenant.TenantId, query.Status, query.Severity, ct);
    }
}
```

- [x] **Step 9: Run tests to verify they pass**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests --filter ReportIncidentHandlerTests`
Expected: PASS (3 tests). Also run the full UnitTests project to confirm no regressions: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests`.

- [x] **Step 10: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Application \
        src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests/ReportIncidentHandlerTests.cs
git commit -m "feat(incident): INC-1 application commands/queries/validators + GIS-ref verification (INC-1)"
```

---

## Task 6: Infrastructure — persistence, repository, read DAO, GIS stub, mapper, migration

**Files:**
- Create: `src/.../Infrastructure/Persistence/IncidentDbContext.cs`
- Create: `src/.../Infrastructure/Persistence/DesignTimeIncidentDbContextFactory.cs`
- Create: `src/.../Infrastructure/Persistence/Models/{NetworkIncidentPersistenceModel,IncidentTimelineEntryModel,IncidentAffectedAssetModel}.cs`
- Create: `src/.../Infrastructure/Persistence/Configurations/{NetworkIncident,IncidentTimelineEntry,IncidentAffectedAsset}Configuration.cs`
- Create: `src/.../Infrastructure/Repositories/NetworkIncidentRepository.cs`
- Create: `src/.../Infrastructure/Repositories/IncidentReadDao.cs`
- Create: `src/.../Infrastructure/GisLookup/{GisLookupOptions,StubGisLookupAdapter}.cs`
- Create: `src/.../Infrastructure/IntegrationEvents/IncidentIntegrationEventMapper.cs`
- Create: migration under `src/.../Infrastructure/Persistence/Migrations/`

- [x] **Step 1: Write the persistence models**

`Infrastructure/Persistence/Models/NetworkIncidentPersistenceModel.cs`:
```csharp
namespace WaterNetwork.Incident.Infrastructure.Persistence.Models;

public sealed class NetworkIncidentPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string Category { get; set; } = default!;
    public int Severity { get; set; }
    public double? Longitude { get; set; }
    public double? Latitude { get; set; }
    public NetTopologySuite.Geometries.Point? Location { get; set; }
    public string Status { get; set; } = default!;
    public string ReportedBy { get; set; } = default!;
    public string? CancellationReason { get; set; }
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<IncidentAffectedAssetModel> AffectedAssets { get; set; } = [];
    public List<IncidentTimelineEntryModel> TimelineEntries { get; set; } = [];
}
```

`Infrastructure/Persistence/Models/IncidentAffectedAssetModel.cs`:
```csharp
namespace WaterNetwork.Incident.Infrastructure.Persistence.Models;

public sealed class IncidentAffectedAssetModel
{
    public string Id { get; set; } = default!;
    public string IncidentId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string AssetId { get; set; } = default!;
    public string Kind { get; set; } = default!;
    public bool Verified { get; set; }
}
```

`Infrastructure/Persistence/Models/IncidentTimelineEntryModel.cs`:
```csharp
namespace WaterNetwork.Incident.Infrastructure.Persistence.Models;

public sealed class IncidentTimelineEntryModel
{
    public string Id { get; set; } = default!;
    public string IncidentId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string EntryType { get; set; } = default!;
    public string ActorId { get; set; } = default!;
    public string? Note { get; set; }
    public DateTime OccurredAt { get; set; }
    public int Sequence { get; set; }
}
```

> Location modelling: `Longitude`/`Latitude` columns store the user-supplied coordinates (and feed the DTO/event directly). `Location` is the PostGIS `geometry(Point,4326)` column kept in sync for future spatial queries (mirrors gis-be). The repository populates both from the aggregate's `Longitude`/`Latitude`. If keeping two representations is deemed redundant during review, drop `Location` and keep only the numeric columns — INC-1 has no spatial query yet.

- [x] **Step 2: Write the EF configurations**

`Infrastructure/Persistence/Configurations/NetworkIncidentConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;

namespace WaterNetwork.Incident.Infrastructure.Persistence.Configurations;

public sealed class NetworkIncidentConfiguration : IEntityTypeConfiguration<NetworkIncidentPersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkIncidentPersistenceModel> builder)
    {
        builder.ToTable("network_incidents");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Category).HasColumnName("category").HasMaxLength(32).IsRequired();
        builder.Property(x => x.Severity).HasColumnName("severity").IsRequired();
        builder.Property(x => x.Longitude).HasColumnName("longitude");
        builder.Property(x => x.Latitude).HasColumnName("latitude");
        builder.Property(x => x.Location).HasColumnName("location").HasColumnType("geometry(Point,4326)");
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
        builder.Property(x => x.ReportedBy).HasColumnName("reported_by").HasMaxLength(128).IsRequired();
        builder.Property(x => x.CancellationReason).HasColumnName("cancellation_reason").HasMaxLength(1000);
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.Status }).HasDatabaseName("ix_incidents_tenant_status");
        builder.HasIndex(x => new { x.TenantId, x.Severity }).HasDatabaseName("ix_incidents_tenant_severity");

        builder.HasMany(x => x.AffectedAssets).WithOne().HasForeignKey(a => a.IncidentId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(x => x.TimelineEntries).WithOne().HasForeignKey(t => t.IncidentId).OnDelete(DeleteBehavior.Cascade);
    }
}
```

`Infrastructure/Persistence/Configurations/IncidentAffectedAssetConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;

namespace WaterNetwork.Incident.Infrastructure.Persistence.Configurations;

public sealed class IncidentAffectedAssetConfiguration : IEntityTypeConfiguration<IncidentAffectedAssetModel>
{
    public void Configure(EntityTypeBuilder<IncidentAffectedAssetModel> builder)
    {
        builder.ToTable("incident_affected_assets");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.IncidentId).HasColumnName("incident_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Kind).HasColumnName("kind").HasMaxLength(16).IsRequired();
        builder.Property(x => x.Verified).HasColumnName("verified").IsRequired();
        builder.HasIndex(x => new { x.TenantId, x.IncidentId }).HasDatabaseName("ix_affected_assets_tenant_incident");
    }
}
```

`Infrastructure/Persistence/Configurations/IncidentTimelineEntryConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;

namespace WaterNetwork.Incident.Infrastructure.Persistence.Configurations;

public sealed class IncidentTimelineEntryConfiguration : IEntityTypeConfiguration<IncidentTimelineEntryModel>
{
    public void Configure(EntityTypeBuilder<IncidentTimelineEntryModel> builder)
    {
        builder.ToTable("incident_timeline_entries");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.IncidentId).HasColumnName("incident_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.EntryType).HasColumnName("entry_type").HasMaxLength(16).IsRequired();
        builder.Property(x => x.ActorId).HasColumnName("actor_id").HasMaxLength(128).IsRequired();
        builder.Property(x => x.Note).HasColumnName("note").HasMaxLength(1000);
        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at");
        builder.Property(x => x.Sequence).HasColumnName("sequence");
        builder.HasIndex(x => new { x.TenantId, x.IncidentId }).HasDatabaseName("ix_timeline_tenant_incident");
    }
}
```

- [x] **Step 3: Write the DbContext + design-time factory**

`Infrastructure/Persistence/IncidentDbContext.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Incident.Infrastructure.Persistence;

public sealed class IncidentDbContext(DbContextOptions<IncidentDbContext> options) : PlatformDbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(IncidentDbContext).Assembly);
    }
}
```

`Infrastructure/Persistence/DesignTimeIncidentDbContextFactory.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WaterNetwork.Incident.Infrastructure.Persistence;

public sealed class DesignTimeIncidentDbContextFactory : IDesignTimeDbContextFactory<IncidentDbContext>
{
    public IncidentDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<IncidentDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=wn_incident;Username=postgres;Password=postgres",
                o => o.UseNetTopologySuite())
            .Options;
        return new IncidentDbContext(options);
    }
}
```

- [x] **Step 4: Write the repository**

`Infrastructure/Repositories/NetworkIncidentRepository.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.Entities;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterNetwork.Incident.Infrastructure.Persistence;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Incident.Infrastructure.Repositories;

public sealed class NetworkIncidentRepository(
    IncidentDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkIncident>(dbContext, eventDispatcher, outboxRepository), INetworkIncidentRepository
{
    private static readonly GeometryFactory GeometryFactory =
        NtsGeometryServices.Instance.CreateGeometryFactory(srid: 4326);

    public override async Task<NetworkIncident?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<NetworkIncidentPersistenceModel>()
            .AsNoTracking()
            .Include(x => x.AffectedAssets)
            .Include(x => x.TimelineEntries)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : ToDomain(m);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Incidents are not deleted in INC-1; use Cancel.");

    protected override async Task PersistAsync(NetworkIncident aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.Set<NetworkIncidentPersistenceModel>()
            .Include(x => x.AffectedAssets)
            .Include(x => x.TimelineEntries)
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

            existing.Category = aggregate.Category.ToString();
            existing.Severity = aggregate.Severity;
            existing.Status = aggregate.Status.ToString();
            existing.CancellationReason = aggregate.CancellationReason;
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;

            // Timeline is append-only: add entries not yet persisted (by sequence).
            foreach (var entry in aggregate.TimelineEntries.Where(e => e.Sequence >= existing.TimelineEntries.Count))
                existing.TimelineEntries.Add(ToModel(entry, aggregate.Id, aggregate.TenantId));
            // Affected refs are set at report time and immutable in INC-1 — no resync needed.
        }
    }

    private static NetworkIncidentPersistenceModel ToModel(NetworkIncident i)
    {
        Point? location = i is { Longitude: { } lng, Latitude: { } lat }
            ? GeometryFactory.CreatePoint(new Coordinate(lng, lat))
            : null;
        return new NetworkIncidentPersistenceModel
        {
            Id = i.Id, TenantId = i.TenantId, Category = i.Category.ToString(), Severity = i.Severity,
            Longitude = i.Longitude, Latitude = i.Latitude, Location = location,
            Status = i.Status.ToString(), ReportedBy = i.ReportedBy, CancellationReason = i.CancellationReason,
            Version = i.Version, CreatedAt = i.CreatedAt, UpdatedAt = i.UpdatedAt,
            AffectedAssets = i.AffectedRefs.Select(r => new IncidentAffectedAssetModel
            {
                Id = Guid.CreateVersion7().ToString(), IncidentId = i.Id, TenantId = i.TenantId,
                AssetId = r.AssetId, Kind = r.Kind.ToString(), Verified = r.Verified
            }).ToList(),
            TimelineEntries = i.TimelineEntries.Select(e => ToModel(e, i.Id, i.TenantId)).ToList()
        };
    }

    private static IncidentTimelineEntryModel ToModel(IncidentTimelineEntry e, string incidentId, string tenantId) => new()
    {
        Id = e.Id, IncidentId = incidentId, TenantId = tenantId, EntryType = e.EntryType.ToString(),
        ActorId = e.ActorId, Note = e.Note, OccurredAt = e.OccurredAt, Sequence = e.Sequence
    };

    private static NetworkIncident ToDomain(NetworkIncidentPersistenceModel m) => NetworkIncident.Reconstitute(
        m.Id, m.TenantId, Enum.Parse<IncidentCategory>(m.Category), m.Severity, m.Longitude, m.Latitude,
        Enum.Parse<IncidentStatus>(m.Status), m.ReportedBy, m.CancellationReason, m.Version, m.CreatedAt, m.UpdatedAt,
        m.AffectedAssets.Select(a => AssetRef.Create(a.AssetId, Enum.Parse<AssetRefKind>(a.Kind), a.Verified)),
        m.TimelineEntries.OrderBy(t => t.Sequence).Select(t => new IncidentTimelineEntry(
            t.Id, Enum.Parse<TimelineEntryType>(t.EntryType), t.ActorId, t.Note, t.OccurredAt, t.Sequence)));
}
```

> `NtsGeometryServices.Instance` / `GeometryFactory` SRID-4326 creation: confirm the exact idiom gis-be uses (`grep -rn "GeometryFactory\|NtsGeometryServices\|CreatePoint" src/services/water-network-gis-be/src`) and match it, including whether they set `new Point(...) { SRID = 4326 }` instead.

- [x] **Step 5: Write the read DAO**

`Infrastructure/Repositories/IncidentReadDao.cs`:
```csharp
using Dapper;
using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Infrastructure.Persistence;

namespace WaterNetwork.Incident.Infrastructure.Repositories;

public sealed class IncidentReadDao(IncidentDbContext dbContext) : IIncidentReadDao
{
    public async Task<IReadOnlyList<IncidentSummaryDto>> ListAsync(
        string tenantId, string? status, int? severity, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id AS Id, category AS Category, severity AS Severity, status AS Status,
                   reported_by AS ReportedBy, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM network_incidents
            WHERE tenant_id = @tenantId
              AND (@status IS NULL OR status = @status)
              AND (@severity IS NULL OR severity = @severity)
            ORDER BY created_at DESC
            LIMIT 500
            """;
        var connection = dbContext.Database.GetDbConnection();
        var rows = await connection.QueryAsync<IncidentSummaryDto>(
            new CommandDefinition(sql, new { tenantId, status, severity }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IncidentDetailDto?> GetDetailAsync(string tenantId, string incidentId, CancellationToken ct = default)
    {
        const string incidentSql = """
            SELECT id AS Id, tenant_id AS TenantId, category AS Category, severity AS Severity,
                   longitude AS Longitude, latitude AS Latitude, status AS Status, reported_by AS ReportedBy,
                   cancellation_reason AS CancellationReason, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM network_incidents
            WHERE id = @incidentId AND tenant_id = @tenantId
            """;
        const string refsSql = """
            SELECT asset_id AS AssetId, kind AS Kind, verified AS Verified
            FROM incident_affected_assets
            WHERE incident_id = @incidentId AND tenant_id = @tenantId
            """;
        const string timelineSql = """
            SELECT entry_type AS EntryType, actor_id AS ActorId, note AS Note,
                   occurred_at AS OccurredAt, sequence AS Sequence
            FROM incident_timeline_entries
            WHERE incident_id = @incidentId AND tenant_id = @tenantId
            ORDER BY sequence
            """;

        var connection = dbContext.Database.GetDbConnection();
        var args = new { incidentId, tenantId };

        var head = await connection.QuerySingleOrDefaultAsync<IncidentHeadRow>(
            new CommandDefinition(incidentSql, args, cancellationToken: ct));
        if (head is null) return null;

        var refs = (await connection.QueryAsync<AffectedAssetDto>(
            new CommandDefinition(refsSql, args, cancellationToken: ct))).ToList();
        var timeline = (await connection.QueryAsync<TimelineEntryDto>(
            new CommandDefinition(timelineSql, args, cancellationToken: ct))).ToList();

        return new IncidentDetailDto(
            head.Id, head.TenantId, head.Category, head.Severity, head.Longitude, head.Latitude,
            head.Status, head.ReportedBy, head.CancellationReason, head.CreatedAt, head.UpdatedAt, refs, timeline);
    }

    private sealed record IncidentHeadRow(
        string Id, string TenantId, string Category, int Severity, double? Longitude, double? Latitude,
        string Status, string ReportedBy, string? CancellationReason, DateTime CreatedAt, DateTime UpdatedAt);
}
```

- [x] **Step 6: Write the GIS stub adapter**

`Infrastructure/GisLookup/GisLookupOptions.cs`:
```csharp
namespace WaterNetwork.Incident.Infrastructure.GisLookup;

public sealed class GisLookupOptions
{
    public const string SectionName = "GisLookup";
    public string Provider { get; set; } = "Stub";
    /// <summary>Known refs the stub treats as existing, each formatted "Kind:assetId" (e.g. "Pipe:pipe-1").</summary>
    public string[] ExistingRefs { get; set; } = [];
}
```

`Infrastructure/GisLookup/StubGisLookupAdapter.cs`:
```csharp
using Microsoft.Extensions.Options;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Infrastructure.GisLookup;

public sealed class StubGisLookupAdapter(IOptions<GisLookupOptions> options) : IGisLookupPort
{
    private readonly HashSet<string> _existing =
        new(options.Value.ExistingRefs, StringComparer.OrdinalIgnoreCase);

    public Task<bool> AssetRefExists(string tenantId, AssetRefKind kind, string assetId, CancellationToken ct = default)
        => Task.FromResult(_existing.Contains($"{kind}:{assetId}"));
}
```

- [x] **Step 7: Write the integration-event mapper**

`Infrastructure/IntegrationEvents/IncidentIntegrationEventMapper.cs`:
```csharp
using WaterNetwork.Incident.Contracts;
using WaterNetwork.Incident.Contracts.Events;
using WaterNetwork.Incident.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Incident.Infrastructure.IntegrationEvents;

public sealed record IncidentReportedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentReportedV1 Data)
    : IIntegrationEvent<IncidentReportedV1>;

public sealed record IncidentClassifiedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentClassifiedV1 Data)
    : IIntegrationEvent<IncidentClassifiedV1>;

public sealed record IncidentCancelledIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, IncidentCancelledV1 Data)
    : IIntegrationEvent<IncidentCancelledV1>;

public sealed class IncidentIntegrationEventMapper : IIntegrationEventMapper
{
    private static readonly Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry =
        new(StringComparer.Ordinal)
        {
            ["IncidentReported"] = e => e is IncidentReported x ? MapReported(x) : null,
            ["IncidentClassified"] = e => e is IncidentClassified x ? MapClassified(x) : null,
            ["IncidentCancelled"] = e => e is IncidentCancelled x ? MapCancelled(x) : null,
        };

    public bool CanMap(string eventType) => Registry.ContainsKey(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
        => Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null;

    private static IncidentReportedIntegrationEvent MapReported(IncidentReported e)
        => new(e.EventId, IncidentEventTypes.Reported, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentReportedV1(e.AggregateId, e.Data.TenantId, e.Data.Category, e.Data.Severity,
                e.Data.Longitude, e.Data.Latitude,
                e.Data.AffectedRefs.Select(r => new AffectedAssetRefV1(r.AssetId, r.Kind, r.Verified)).ToList(),
                e.Data.ReportedBy));

    private static IncidentClassifiedIntegrationEvent MapClassified(IncidentClassified e)
        => new(e.EventId, IncidentEventTypes.Classified, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentClassifiedV1(e.AggregateId, e.Data.TenantId, e.Data.Category, e.Data.Severity,
                e.Data.ActorId, e.Data.Note));

    private static IncidentCancelledIntegrationEvent MapCancelled(IncidentCancelled e)
        => new(e.EventId, IncidentEventTypes.Cancelled, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new IncidentCancelledV1(e.AggregateId, e.Data.TenantId, e.Data.Reason, e.Data.ActorId));
}
```

- [x] **Step 8: Verify the Infrastructure project compiles**

Run: `dotnet build src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure`
Expected: PASS. Fix any namespace/signature mismatches surfaced by the build before generating the migration.

- [x] **Step 9: Generate the EF migration**

Run:
```bash
dotnet ef migrations add AddIncidentTables \
  -p src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure \
  -s src/services/water-network-incident-be/src/WaterNetwork.Incident.Api \
  -o Persistence/Migrations
```
Expected: creates `Persistence/Migrations/<timestamp>_AddIncidentTables.cs` + `..Designer.cs` + `IncidentDbContextModelSnapshot.cs`. Open the migration and confirm it creates `network_incidents` (with `location geometry(Point,4326)`), `incident_affected_assets`, `incident_timeline_entries`, plus the outbox/idempotency/processed-event tables inherited from `PlatformDbContext`.

> Requires `dotnet-ef` installed and a reachable Postgres only for `database update` — `migrations add` works offline via the design-time factory. If the tool is missing: `dotnet tool install --global dotnet-ef` (or check `dotnet ef` is referenced as a local tool in the repo).

- [x] **Step 10: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Infrastructure
git commit -m "feat(incident): INC-1 EF persistence + repository + read DAO + GIS stub + mapper + migration (INC-1)"
```

---

## Task 7: Api — Program.cs, endpoints, requests, config, Docker

**Files:**
- Create: `src/.../Api/Requests/{ReportIncidentRequest,ClassifyIncidentRequest,CancelIncidentRequest}.cs`
- Create: `src/.../Api/Endpoints/IncidentsEndpointModule.cs`
- Create: `src/.../Api/Program.cs`
- Create: `src/.../Api/appsettings.json`
- Create: `src/services/water-network-incident-be/Dockerfile`
- Modify: `docker-compose.yml`

- [x] **Step 1: Write the request DTOs**

`Api/Requests/ReportIncidentRequest.cs`:
```csharp
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Api.Requests;

public sealed record ReportIncidentAffectedRefRequest(string AssetId, AssetRefKind Kind);

public sealed record ReportIncidentRequest(
    IncidentCategory Category,
    int Severity,
    double? Longitude,
    double? Latitude,
    IReadOnlyList<ReportIncidentAffectedRefRequest>? AffectedRefs);
```

`Api/Requests/ClassifyIncidentRequest.cs`:
```csharp
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Api.Requests;

public sealed record ClassifyIncidentRequest(IncidentCategory Category, int Severity, string? Note);
```

`Api/Requests/CancelIncidentRequest.cs`:
```csharp
namespace WaterNetwork.Incident.Api.Requests;

public sealed record CancelIncidentRequest(string Reason);
```

- [x] **Step 2: Write the endpoint module**

`Api/Endpoints/IncidentsEndpointModule.cs`:
```csharp
using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Incident.Api.Requests;
using WaterNetwork.Incident.Application.Commands;
using WaterNetwork.Incident.Application.Dtos;
using WaterNetwork.Incident.Application.Queries;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Incident.Api.Endpoints;

public sealed class IncidentsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/incidents");

        group.MapPost("/", async (ReportIncidentRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                var refs = (request.AffectedRefs ?? [])
                    .Select(r => new ReportIncidentAssetRef(r.AssetId, r.Kind)).ToList();
                var id = await bus.ExecuteAsync(new ReportIncidentCommand(
                    request.Category, request.Severity, request.Longitude, request.Latitude, refs), ct);
                return Results.Created($"/api/incidents/{id}", new { id });
            })
            .RequirePermission("network-incident:write");

        group.MapGet("/", async Task<Ok<IReadOnlyList<IncidentSummaryDto>>> (
                string? status, int? severity, IQueryBus bus, CancellationToken ct) =>
            {
                var items = await bus.ExecuteAsync(new ListIncidentsQuery(status, severity), ct);
                return TypedResults.Ok(items);
            })
            .RequirePermission("network-incident:read");

        group.MapGet("/{id}", async Task<Results<Ok<IncidentDetailDto>, NotFound>> (
                string id, IQueryBus bus, CancellationToken ct) =>
            {
                var dto = await bus.ExecuteAsync(new GetIncidentDetailQuery(id), ct);
                return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto);
            })
            .RequirePermission("network-incident:read");

        group.MapPost("/{id}/classify", async (
                string id, ClassifyIncidentRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new ClassifyIncidentCommand(id, request.Category, request.Severity, request.Note), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-incident:write");

        group.MapPost("/{id}/cancel", async (
                string id, CancelIncidentRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                await bus.ExecuteAsync(new CancelIncidentCommand(id, request.Reason), ct);
                return Results.NoContent();
            })
            .RequirePermission("network-incident:write");
    }
}
```

> `.WithValidation<T>()` is available for JSON-body endpoints (see design-be). INC-1 validation lives in the command validators, which the CQRS pipeline behaviour runs (`AddPlatformCqrsBehaviors`). Confirm whether design-be relies on the validation behaviour or the endpoint filter; if it uses `.WithValidation<ReportIncidentRequest>()` add request-level validators mirroring the command validators. Default here: command-level validators via the pipeline (matches `CreateDesignProjectCommandValidator` usage).

- [x] **Step 3: Write Program.cs**

`Api/Program.cs`:
```csharp
using FluentValidation;
using WaterNetwork.Incident.Application.Commands;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Infrastructure.GisLookup;
using WaterNetwork.Incident.Infrastructure.IntegrationEvents;
using WaterNetwork.Incident.Infrastructure.Persistence;
using WaterNetwork.Incident.Infrastructure.Repositories;
using WaterPlatform.BuildingBlocks.Application;
using WaterPlatform.BuildingBlocks.EventBus;
using WaterPlatform.BuildingBlocks.Infrastructure;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Observability;
using WaterPlatform.BuildingBlocks.WebApi.Bootstrap;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddObservability(builder.Configuration);

builder.Services.AddPlatformCqrs();
builder.Services.AddPlatformCqrsBehaviors();

builder.Services.AddPlatformPersistence<IncidentDbContext>(builder.Configuration, o => o.UseNetTopologySuite());
builder.Services.AddPlatformOutbox(builder.Configuration);

builder.Services.AddPlatformEventBus(builder.Configuration);

builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

builder.Services.AddHandlersFromAssembly(typeof(ReportIncidentCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(ReportIncidentCommand).Assembly);

builder.Services.AddScoped<INetworkIncidentRepository, NetworkIncidentRepository>();
builder.Services.AddScoped<IIncidentReadDao, IncidentReadDao>();

builder.Services.AddSingleton<IIntegrationEventMapper, IncidentIntegrationEventMapper>();

builder.Services.Configure<GisLookupOptions>(builder.Configuration.GetSection(GisLookupOptions.SectionName));
builder.Services.AddSingleton<IGisLookupPort, StubGisLookupAdapter>();

builder.Services.AddOutboxDomainEventTypesFromAssembly(
    typeof(WaterNetwork.Incident.Domain.DomainEvents.IncidentReported).Assembly);

var app = builder.Build();

app.UsePlatformWebApi();
app.MapHealthChecks("/health");
app.MapEndpointModules(app.Services, typeof(Program).Assembly);

app.Run();

public partial class Program;
```

> Cross-check this against the current `water-network-design-be/src/.../Api/Program.cs` line-by-line before running — building-block extension method names (`AddPlatformCqrs`, `AddPlatformOutbox`, `AddPlatformEventBus`, `AddPlatformWebApi`, `AddDefaultHealthChecks`, `MapEndpointModules`, `AddObservability`, `AddSerilogLogging`) must match exactly. INC-1 registers no MassTransit consumers (it only produces), so `AddPlatformEventBus` takes no consumer-config lambda — verify that overload exists; if `AddPlatformEventBus` requires the lambda, pass an empty `_ => { }`.

- [x] **Step 4: Write appsettings.json**

`Api/appsettings.json`:
```json
{
  "ServiceName": "water-network-incident-be",
  "ConnectionStrings": {
    "PostgreSQL": "Host=localhost;Port=5432;Database=wn_incident;Username=postgres;Password=postgres",
    "Redis": ""
  },
  "EventBus": {
    "Producer": "water-network-incident-be",
    "Transport": "RabbitMq"
  },
  "MassTransit": {
    "RabbitMq": { "Host": "localhost", "Username": "guest", "Password": "guest" }
  },
  "MultiTenancy": { "AllowHeaderFallback": true },
  "Jwt": { "Mode": "Mock" },
  "Outbox": { "BatchSize": 20, "MaxRetries": 5, "PollingIntervalSeconds": 5 },
  "GisLookup": {
    "Provider": "Stub",
    "ExistingRefs": []
  },
  "Database": { "ApplyMigrationsOnStartup": false },
  "Serilog": { "MinimumLevel": { "Default": "Information" } }
}
```

> Also create `appsettings.Development.json` if design-be has one — copy and adjust `ServiceName`/DB name.

- [x] **Step 5: Write the Dockerfile**

`src/services/water-network-incident-be/Dockerfile`:
```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/ src/
RUN dotnet publish src/services/water-network-incident-be/src/WaterNetwork.Incident.Api -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "WaterNetwork.Incident.Api.dll"]
```

> Diff against `src/services/water-network-design-be/Dockerfile` and match exactly (COPY lines, base image tags).

- [x] **Step 6: Add the docker-compose entry**

In `docker-compose.yml`, add (port `8085` — confirm it's unused; design-be uses `8084`, bff `8083`):
```yaml
  water-network-incident-be:
    build:
      context: .
      dockerfile: src/services/water-network-incident-be/Dockerfile
    ports: ["8085:8080"]
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - ConnectionStrings__PostgreSQL=Host=postgres;Port=5432;Database=wn_incident;Username=postgres;Password=postgres
      - ConnectionStrings__Redis=redis:6379,abortConnect=false
      - MassTransit__RabbitMq__Host=rabbitmq
      - OpenTelemetry__OtlpEndpoint=http://jaeger:4317
      - Database__ApplyMigrationsOnStartup=true
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }
    networks: [wn-network]
```

- [x] **Step 7: Verify the whole solution builds**

Run: `dotnet build src/services/water-network-incident-be/WaterNetwork.Incident.slnx`
Expected: PASS — `0 Warning(s) 0 Error(s)`.

- [x] **Step 8: Commit**

```bash
git add src/services/water-network-incident-be/src/WaterNetwork.Incident.Api \
        src/services/water-network-incident-be/Dockerfile docker-compose.yml
git commit -m "feat(incident): INC-1 API endpoints + Program wiring + config + Docker (INC-1)"
```

---

## Task 8: Integration tests

**Files:**
- Create: `tests/WaterNetwork.Incident.IntegrationTests/IncidentApiFactory.cs`
- Create: `tests/WaterNetwork.Incident.IntegrationTests/CollectionFixtures.cs`
- Create: `tests/WaterNetwork.Incident.IntegrationTests/IncidentApiTests.cs`

- [x] **Step 1: Write the test factory + collection fixture**

`tests/WaterNetwork.Incident.IntegrationTests/IncidentApiFactory.cs`:
```csharp
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterNetwork.Incident.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

public sealed class IncidentApiFactory(PostgisFixture postgis) : WebApplicationFactory<Program>
{
    public Dictionary<string, string?> ConfigOverrides { get; } = new();

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:PostgreSQL"] = postgis.ConnectionString,
            ["ConnectionStrings:Redis"] = "",
            ["EventBus:Transport"] = "InMemory",
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["Jwt:Mode"] = "Mock"
        }));
        if (ConfigOverrides.Count > 0)
            builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(ConfigOverrides));

        var host = base.CreateHost(builder);
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<IncidentDbContext>().Database.Migrate();
        return host;
    }
}
```

`tests/WaterNetwork.Incident.IntegrationTests/CollectionFixtures.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

#pragma warning disable CA1711
[CollectionDefinition("incident-postgis")]
public sealed class IncidentPostgisCollection : ICollectionFixture<PostgisFixture> { }
#pragma warning restore CA1711
```

> Compare `IncidentApiFactory` against `DesignApiFactory` exactly — match the same config keys it sets (the design factory sets `FileStorage:*` which incident doesn't need; drop those). Confirm `PostgisFixture.ConnectionString` member name.

- [x] **Step 2: Write the failing integration tests**

`tests/WaterNetwork.Incident.IntegrationTests/IncidentApiTests.cs`:
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
public sealed class IncidentApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(IncidentApiFactory factory, string tenantId = "tenant-1")
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "operator-1", tenantId: tenantId,
            permissions: ["network-incident:write", "network-incident:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static IncidentApiFactory NewFactory(PostgisFixture pg, params string[] existingRefs)
    {
        var f = new IncidentApiFactory(pg);
        for (var i = 0; i < existingRefs.Length; i++)
            f.ConfigOverrides[$"GisLookup:ExistingRefs:{i}"] = existingRefs[i];
        return f;
    }

    [Fact]
    public async Task Report_Then_Get_Detail_Returns_Reported_Incident()
    {
        using var factory = NewFactory(postgis, "Pipe:pipe-1");
        using var client = Client(factory);

        var resp = await client.PostAsJsonAsync("/api/incidents", new
        {
            category = "PipeBurst",
            severity = 3,
            longitude = 106.7,
            latitude = 10.8,
            affectedRefs = new[] { new { assetId = "pipe-1", kind = "Pipe" } }
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("Reported");
        detail["severity"]!.GetValue<int>().Should().Be(3);
        detail["affectedRefs"]!.AsArray().Should().ContainSingle();
        detail["affectedRefs"]![0]!["verified"]!.GetValue<bool>().Should().BeTrue();
        detail["timeline"]!.AsArray().Should().ContainSingle();
    }

    [Fact]
    public async Task Report_With_Unknown_Ref_Stores_It_Unverified()
    {
        using var factory = NewFactory(postgis); // no existing refs configured
        using var client = Client(factory);

        var resp = await client.PostAsJsonAsync("/api/incidents", new
        {
            category = "Leak",
            severity = 2,
            affectedRefs = new[] { new { assetId = "ghost", kind = "Node" } }
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["affectedRefs"]![0]!["verified"]!.GetValue<bool>().Should().BeFalse();
    }

    [Fact]
    public async Task Report_With_Invalid_Severity_Returns_400()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);

        var resp = await client.PostAsJsonAsync("/api/incidents",
            new { category = "Other", severity = 9 });
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Classify_Moves_Status_And_Appends_Timeline()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);
        var id = await Report(client);

        var classify = await client.PostAsJsonAsync($"/api/incidents/{id}/classify",
            new { category = "WaterLoss", severity = 4, note = "field-assessed" });
        classify.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("Classified");
        detail["category"]!.GetValue<string>().Should().Be("WaterLoss");
        detail["timeline"]!.AsArray().Count.Should().Be(2);
    }

    [Fact]
    public async Task Cancel_Moves_To_Cancelled()
    {
        using var factory = NewFactory(postgis);
        using var client = Client(factory);
        var id = await Report(client);

        var cancel = await client.PostAsJsonAsync($"/api/incidents/{id}/cancel",
            new { reason = "duplicate" });
        cancel.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var detail = await client.GetFromJsonAsync<JsonNode>($"/api/incidents/{id}");
        detail!["status"]!.GetValue<string>().Should().Be("Cancelled");
        detail["cancellationReason"]!.GetValue<string>().Should().Be("duplicate");
    }

    [Fact]
    public async Task List_Filters_By_Status_And_Is_Tenant_Scoped()
    {
        using var factory = NewFactory(postgis);
        using var t1 = Client(factory, "tenant-1");
        using var t2 = Client(factory, "tenant-2");

        await Report(t1);
        await Report(t2);

        var t1List = (await t1.GetFromJsonAsync<JsonNode>("/api/incidents?status=Reported"))!.AsArray();
        t1List.Count.Should().Be(1);
    }

    [Fact]
    public async Task Get_Other_Tenants_Incident_Returns_404()
    {
        using var factory = NewFactory(postgis);
        using var t1 = Client(factory, "tenant-1");
        using var t2 = Client(factory, "tenant-2");
        var id = await Report(t1);

        var resp = await t2.GetAsync($"/api/incidents/{id}");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Classify_Other_Tenants_Incident_Returns_404()
    {
        using var factory = NewFactory(postgis);
        using var t1 = Client(factory, "tenant-1");
        using var t2 = Client(factory, "tenant-2");
        var id = await Report(t1);

        var resp = await t2.PostAsJsonAsync($"/api/incidents/{id}/classify",
            new { category = "Other", severity = 1, note = (string?)null });
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private static async Task<string> Report(HttpClient client)
    {
        var resp = await client.PostAsJsonAsync("/api/incidents",
            new { category = "PipeBurst", severity = 3 });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
    }
}
```

> The `ConfigOverrides[$"GisLookup:ExistingRefs:{i}"]` keys bind an array element via `IConfiguration` array syntax. Confirm this binds correctly to `GisLookupOptions.ExistingRefs`; if not, instead override a single colon-joined key or expose a test seam. Also confirm the validation-failure path returns 400 (the `GlobalExceptionMiddleware` maps FluentValidation failures) — if the pipeline maps to 422, adjust the `Report_With_Invalid_Severity` assertion to match the platform convention.

- [x] **Step 3: Run the integration tests**

Run: `dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests`
Expected: PASS (8 tests). Requires Docker running for `PostgisFixture` (Testcontainers). Debug any cross-tenant/validation mismatches against the platform conventions before proceeding.

- [x] **Step 4: Commit**

```bash
git add src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests
git commit -m "test(incident): INC-1 integration tests (report/classify/cancel/list + cross-tenant 404) (INC-1)"
```

---

## Task 9: Register events, update tracking, final verification

**Files:**
- Modify: `docs/conventions/event-catalog.md`
- Modify: `docs/stories/backlog.md`
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`

- [x] **Step 1: Register the three events in the catalog**

Add to the table in `docs/conventions/event-catalog.md` (after the last design row):
```markdown
| `incident.reported` | v1 | water-network-incident-be | (none yet; INC-2 isolation, Phase 4 maintenance [future]) | `IncidentReportedV1` | shipped (INC-1) |
| `incident.classified` | v1 | water-network-incident-be | (none yet) | `IncidentClassifiedV1` | shipped (INC-1) |
| `incident.cancelled` | v1 | water-network-incident-be | (none yet) | `IncidentCancelledV1` | shipped (INC-1) |
```

- [x] **Step 2: Update the backlog**

In `docs/stories/backlog.md`, change the Phase 3 row status:
```markdown
| Phase 3 — Topology + Incident | topology-rs graph/gRPC, incident-be lifecycle + isolation plan (US-P3-01..05) | in progress (TOP-1..3 done, INC-1 done) |
```
And add a follow-up section:
```markdown
## Follow-up sau INC-1 (Report/Classify incident)

INC-1 dựng service `water-network-incident-be` (Clean arch 5 layer) + `NetworkIncident`
aggregate (state subset `Reported/Classified/Cancelled`), timeline append-only, query
list/detail, GIS-ref verification qua `IGisLookupPort` (stub) → cờ `unverified` không
block. Events `incident.reported/classified/cancelled` v1. Decision 0021. DB `wn_incident`.

- **State machine mở rộng (INC-2/INC-3)**: thêm `IsolationRequested → … → Resolved` + transition tương ứng khi có handler.
- **Real GIS adapter**: thay `StubGisLookupAdapter` bằng HTTP/gRPC gọi gis-be (swap qua `GisLookup:Provider`); INC-2 wire khi cần resolve ref thật + re-verify `unverified`.
- **`network-incident:*` permission**: chưa enforce qua Keycloak thật (US-X); endpoint khai báo `RequirePermission`. `:confirm` thêm ở INC-3.
- **Location chỉ lưu, chưa query không gian**: cột `location geometry(Point,4326)` + `longitude/latitude` song song; cân nhắc bỏ một biểu diễn nếu review thấy dư.
- **List cap 500 cứng, không phân trang/cursor**: thêm paging khi UI cần.
- **Affected ref immutable sau report (INC-1)**: không update/append ref; thêm khi nghiệp vụ cần.
- **No consumer cho 3 event**: catalog ghi nhận; consumer thêm khi notification/impact flow định nghĩa.
```

- [x] **Step 3: Tick the roadmap checkbox**

In `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §3.3, mark the INC-1 row:
```markdown
| 3 | INC-1 Report/Classify incident ✓ | incident-be | US-P3-03 | — |
```

- [x] **Step 4: Full verification — build + all incident tests, zero warnings**

Run:
```bash
dotnet build src/services/water-network-incident-be/WaterNetwork.Incident.slnx
dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.UnitTests
dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.ContractTests
dotnet test src/services/water-network-incident-be/tests/WaterNetwork.Incident.IntegrationTests
```
Expected: build `0 Warning(s) 0 Error(s)`; all three test projects green. (Per CLAUDE.md: slice ends with `dotnet test` green, 0 warnings.)

> Run each test `.csproj` individually — do NOT pass the `.slnx` to `dotnet test` (SDK 10.0.107 silently runs 0 tests on `.slnx`; see backlog GIS-2 follow-up).

- [x] **Step 5: Commit**

```bash
git add docs/conventions/event-catalog.md docs/stories/backlog.md \
        docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md
git commit -m "docs(incident): INC-1 register events + backlog/roadmap update + follow-ups (INC-1)"
```

---

## Self-Review

**Spec coverage (US-P3-03 + roadmap §9.3 item 1):**
- "category, location/asset ref, severity → create NetworkIncident" → Task 3 (aggregate `Report`), Task 5 (handler), Task 7 (endpoint). ✓
- "missing category or severity → validation error" → Task 5 validator (`IsInEnum`, `InclusiveBetween(1,4)`) + Task 8 `Report_With_Invalid_Severity_Returns_400`. ✓
- "status = Reported on create" → Task 3 + Task 8 detail assertion. ✓
- "publish incident.reported" → Task 4 contract, Task 6 mapper, Task 7 outbox wiring (`AddPlatformOutbox` + `AddOutboxDomainEventTypesFromAssembly`). ✓
- "linked asset not exist → rule (unverifiedAssetRef)" → Task 5 handler GIS lookup + Task 6 stub + Task 8 `Report_With_Unknown_Ref_Stores_It_Unverified`. ✓
- ClassifyIncident / CancelIncident / timeline / list / detail (roadmap §9.3) → Tasks 3, 5, 7, 8. ✓
- Events registered in catalog (US-X-03 rule) → Task 9. ✓
- Decision record for new contract → Task 0. ✓
- Cross-tenant 404 (decision 0016) → Task 5 handlers + Task 8 cross-tenant tests. ✓

**Type consistency:** `AssetRef.Create(string, AssetRefKind, bool)`, `NetworkIncident.Report(...)`/`.Classify(...)`/`.Cancel(...)`, `IncidentStatus { Reported, Classified, Cancelled }`, `IGisLookupPort.AssetRefExists(tenantId, kind, assetId, ct)`, `IIncidentReadDao.{GetDetailAsync, ListAsync}`, event records `Incident{Reported,Classified,Cancelled}` ↔ V1 contracts — names match across Tasks 2–8. `NotFoundException.Entity` (not `.Resource`) per actual building-block API.

**Placeholder scan:** No TBD/TODO/"add validation"/"similar to" — all steps carry full code. Inline `> NOTE` callouts flag spots where the executor must confirm an exact building-block signature against the live code before running (e.g. `BusinessRuleException.Violation` arity, `TenantContext` ctor, `AddPlatformEventBus` overload, NTS Point idiom, `.WithValidation` vs pipeline). These are verification reminders, not missing content.

**Known unknowns the executor must verify against the live codebase (each has a fallback in-plan):** mocking lib in unit tests (NSubstitute vs hand fakes); `ITenantContext`/`TenantContext` shape; `AddPlatformEventBus` no-consumer overload; FluentValidation failure → 400 vs 422 mapping; `IConfiguration` array binding for `GisLookup:ExistingRefs`; NTS geometry-factory idiom; design-be `.slnx`/`Dockerfile`/factory exact contents to diff against.
