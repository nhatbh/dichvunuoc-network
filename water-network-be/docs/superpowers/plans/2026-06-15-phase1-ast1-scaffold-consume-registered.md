# AST-1 — Scaffold `asset-be` + Consume Registered Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `water-network-asset-be` microservice and make it create a minimal `NetworkAsset` profile (status `Active`) whenever GIS publishes `network.node.registered` / `network.pipe.registered` / `network.device.installed`, then publish its own `asset.registered` event — proven end-to-end through real Postgres + RabbitMQ containers.

**Architecture:** 5-project Clean/DDD slice mirroring `water-network-gis-be` (Api / Application / Contracts / Domain / Infrastructure) on top of the shared building-blocks. `asset-be` is the platform's **first integration-event consumer**: every event travels the wire as a single `IntegrationEventEnvelope` CLR type (one platform exchange), so the consumer subscribes to `IConsumer<IntegrationEventEnvelope>`, filters by `EventType`, deserializes the JSON `Payload` into the producer's published `*.Contracts` V1 record, and dedupes by `EventId` through `IInboxMessageStore`. The created aggregate raises `AssetRegistered`, which flows out through `asset-be`'s own transactional Outbox exactly like GIS. `assetId` reuses the GIS asset id as primary key → natural idempotency.

**Tech Stack:** .NET 10, EF Core 10 + Npgsql, MassTransit 8.5 (RabbitMQ), Dapper (not needed here), xUnit + FluentAssertions + Testcontainers (PostgisFixture, RabbitMqFixture), Central Package Management.

---

## Background — established patterns this slice MUST follow

Read these before starting; the plan assumes you have seen them.

| Concern | Reference (study, then mirror) |
|---|---|
| 5-project layout, slnx | `src/services/water-network-gis-be/WaterNetwork.Gis.slnx` + the five `.csproj` |
| Program.cs DI wiring | `…/WaterNetwork.Gis.Api/Program.cs` |
| DbContext over base | `…/Infrastructure/Persistence/GisDbContext.cs` : `PlatformDbContext` |
| Design-time factory | `…/Infrastructure/Persistence/DesignTimeGisDbContextFactory.cs` |
| Aggregate + domain event | `…/Domain/Aggregates/NetworkNode.cs`, `…/Domain/DomainEvents/NodeRegistered.cs` |
| Repository (outbox-aware) | `…/Infrastructure/Repositories/NetworkNodeRepository.cs` (extends `AggregateRepositoryBase`) |
| Persistence model + EF config | `…/Persistence/NetworkNodePersistenceModel.cs`, `…/Configurations/NetworkNodeConfiguration.cs` |
| Outbox integration mapper | `…/Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs` |
| Outbox pipeline test | `…/tests/…IntegrationTests/OutboxPublishPipelineTests.cs` |
| Contract test | `…/tests/…ContractTests/NetworkNodeRegisteredContractTests.cs` |
| Test app factory | `…/tests/…IntegrationTests/GisApiFactory.cs` |
| Test fixtures | `src/building-blocks/src/WaterPlatform.BuildingBlocks.Testing/{PostgisFixture,RabbitMqFixture}.cs` |
| Wire format (the crux) | `…EventBus/Integration/IntegrationEventEnvelope.cs`, `…EventBus/MassTransitIntegrationEventPublisher.cs`, `…EventBus/MassTransitConfiguration.cs` (note `configureConsumers` param) |
| Inbox dedup | `…Infrastructure/Persistence/InboxMessageStore.cs` (`IInboxMessageStore`) |
| Consumed contracts | `…/WaterNetwork.Gis.Contracts/Events/{GisEventTypes,NetworkNodeRegisteredV1,NetworkPipeRegisteredV1,NetworkDeviceInstalledV1}.cs` |

**Key facts that shape this slice:**

1. **Wire format.** `MassTransitIntegrationEventPublisher` publishes a single `IntegrationEventEnvelope { EventId, EventType, EventVersion, OccurredAt, …, Producer, Payload }`. `Payload = JsonSerializer.Serialize(concreteIntegrationEvent, runtimeType)`, whose shape is `{ EventId, EventType, …, Data: <V1 record> }`. The envelope is **not** an `IIntegrationEvent`, so the existing generic `IdempotentIntegrationEventConsumer<T>` does NOT fit — `asset-be` establishes the envelope-consume convention (recorded in decision 0011, Task 8).
2. **One exchange, all events.** A consumer receives **every** platform event and MUST filter by `EventType`, ignoring unknown types.
3. **Tenant from payload, not envelope.** Outbox-published envelopes have null tenant fields (see remarks in `MassTransitIntegrationEventPublisher`). Always read `TenantId` from the deserialized `Data`.
4. **Cross-service dependency rule.** `asset-be` may reference the producer's **Contracts** assembly only (`WaterNetwork.Gis.Contracts`) — never its Domain/Infrastructure. This is the "GIS-1 contract" dependency from roadmap §3.3.
5. **`wn_asset` DB already exists** in `scripts/init-databases.sql` (no PostGIS extension — asset-be is non-spatial). No change needed there.
6. **Central Package Management.** `.csproj` reference packages **without** versions; versions live in `Directory.Packages.props` (MassTransit 8.5.0, Npgsql.EFCore 10.0.2, FluentValidation 11.11.0 already present).
7. **`Guid.CreateVersion7()`** is the id convention (decision: `docs/superpowers/specs/2026-06-13-uuid-v7-ids-design.md`). asset-be does NOT mint asset ids — it reuses the GIS id.

## File Structure (created by this slice)

```
src/services/water-network-asset-be/
  WaterNetwork.Asset.slnx
  Dockerfile
  src/
    WaterNetwork.Asset.Api/                 → Program.cs, appsettings(.Development).json, Properties/launchSettings.json, HealthCheck endpoint via building-blocks
    WaterNetwork.Asset.Application/          → (thin for AST-1; holds nothing command-side yet — kept so AST-2 lands here)
    WaterNetwork.Asset.Contracts/            → AssetEventTypes.cs, Events/AssetRegisteredV1.cs
    WaterNetwork.Asset.Domain/               → ValueObjects/{AssetType,AssetStatus}.cs, Entities/AssetLifecycleEntry.cs,
                                               Aggregates/NetworkAsset.cs, DomainEvents/AssetRegistered.cs, Repositories/INetworkAssetRepository.cs
    WaterNetwork.Asset.Infrastructure/       → Persistence/{AssetDbContext, DesignTimeAssetDbContextFactory,
                                               NetworkAssetPersistenceModel, AssetLifecycleEntryPersistenceModel,
                                               Configurations/*}, Repositories/NetworkAssetRepository.cs,
                                               IntegrationEvents/AssetIntegrationEventMapper.cs,
                                               Consumers/GisAssetRegistrationConsumer.cs, Migrations/*
  tests/
    WaterNetwork.Asset.UnitTests/            → Domain/{NetworkAssetTests, AssetTypeTests, AssetStatusTests}
    WaterNetwork.Asset.ContractTests/        → AssetRegisteredContractTests
    WaterNetwork.Asset.IntegrationTests/     → AssetApiFactory, HealthCheckTests, NetworkAssetRepositoryTests,
                                               OutboxPublishPipelineTests, GisAssetRegistrationConsumerTests,
                                               GisRegistrationEndToEndTests (real RabbitMQ)
docs/decisions/0011-integration-event-consume-convention.md
docs/conventions/event-catalog.md           (created here; asset.registered + the 3 consumed GIS events)
```

> **Application project for AST-1:** it has no types yet but is created now so the slice's project graph matches GIS and AST-2's lifecycle commands have a home. The Api references it (mirrors GIS). If TDD pressure makes an empty csproj feel like noise, keep it — removing/re-adding later churns the slnx and Program references.

---

### Task 1: Scaffold the 5-project solution + health check

**Files:**
- Create: `src/services/water-network-asset-be/WaterNetwork.Asset.slnx`
- Create: the five `.csproj` (Api, Application, Contracts, Domain, Infrastructure)
- Create: `…/Api/Program.cs`, `…/Api/appsettings.json`, `…/Api/appsettings.Development.json`, `…/Api/Properties/launchSettings.json`
- Create: `…/Infrastructure/Persistence/AssetDbContext.cs`, `…/Persistence/DesignTimeAssetDbContextFactory.cs`
- Create: `Dockerfile`
- Test: `tests/WaterNetwork.Asset.IntegrationTests/{WaterNetwork.Asset.IntegrationTests.csproj, AssetApiFactory.cs, HealthCheckTests.cs}`

- [ ] **Step 1: Create the project files and Program wiring**

`Domain.csproj` (no external refs but building-blocks Domain):
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
</Project>
```

`Contracts.csproj` — no references, leaf project (matches `WaterNetwork.Gis.Contracts`):
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

`Application.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Asset.Domain/WaterNetwork.Asset.Domain.csproj" />
    <ProjectReference Include="../WaterNetwork.Asset.Contracts/WaterNetwork.Asset.Contracts.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Application/WaterPlatform.BuildingBlocks.Application.csproj" />
  </ItemGroup>
</Project>
```

`Infrastructure.csproj` — note the **`WaterNetwork.Gis.Contracts`** reference (consumed contracts) and EventBus:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Asset.Application/WaterNetwork.Asset.Application.csproj" />
    <ProjectReference Include="../WaterNetwork.Asset.Domain/WaterNetwork.Asset.Domain.csproj" />
    <ProjectReference Include="../WaterNetwork.Asset.Contracts/WaterNetwork.Asset.Contracts.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Infrastructure/WaterPlatform.BuildingBlocks.Infrastructure.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.EventBus/WaterPlatform.BuildingBlocks.EventBus.csproj" />
    <!-- Consumed contracts (producer's published surface ONLY — never Gis.Domain/Infrastructure). -->
    <ProjectReference Include="../../../water-network-gis-be/src/WaterNetwork.Gis.Contracts/WaterNetwork.Gis.Contracts.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" />
  </ItemGroup>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <NoWarn>$(NoWarn);CA1861</NoWarn>
  </PropertyGroup>
</Project>
```

`Api.csproj` (mirrors GIS Api):
```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Asset.Application/WaterNetwork.Asset.Application.csproj" />
    <ProjectReference Include="../WaterNetwork.Asset.Infrastructure/WaterNetwork.Asset.Infrastructure.csproj" />
    <ProjectReference Include="../WaterNetwork.Asset.Contracts/WaterNetwork.Asset.Contracts.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.WebApi/WaterPlatform.BuildingBlocks.WebApi.csproj" />
  </ItemGroup>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>
</Project>
```

`AssetDbContext.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class AssetDbContext(DbContextOptions<AssetDbContext> options) : PlatformDbContext(options)
{
    public DbSet<NetworkAssetPersistenceModel> NetworkAssets => Set<NetworkAssetPersistenceModel>();
    public DbSet<AssetLifecycleEntryPersistenceModel> AssetLifecycleEntries => Set<AssetLifecycleEntryPersistenceModel>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder); // applies outbox / idempotency / processed-events configs
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AssetDbContext).Assembly);
    }
}
```
> The persistence models referenced here are created in Task 4. To keep Task 1 compiling, create **empty placeholder** classes `NetworkAssetPersistenceModel` and `AssetLifecycleEntryPersistenceModel` with just `public string Id { get; set; } = default!;` now, and flesh them out in Task 4. (Alternatively, defer the two `DbSet` lines + `ApplyConfigurations…` until Task 4 — but the placeholder keeps the build green and the context shape visible.)

`DesignTimeAssetDbContextFactory.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class DesignTimeAssetDbContextFactory : IDesignTimeDbContextFactory<AssetDbContext>
{
    public AssetDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AssetDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=wn_asset;Username=postgres;Password=postgres")
            .Options;
        return new AssetDbContext(options);
    }
}
```

`Program.cs` (no `UseNetTopologySuite` — non-spatial; the consumer + mapper DI lines are added in Tasks 5–6, leave TODO markers):
```csharp
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application;
using WaterPlatform.BuildingBlocks.EventBus;
using WaterPlatform.BuildingBlocks.Infrastructure;
using WaterPlatform.BuildingBlocks.Observability;
using WaterPlatform.BuildingBlocks.WebApi.Bootstrap;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddObservability(builder.Configuration);
builder.Services.AddPlatformCqrs();
builder.Services.AddPlatformCqrsBehaviors();
builder.Services.AddPlatformPersistence<AssetDbContext>(builder.Configuration);
builder.Services.AddPlatformOutbox(builder.Configuration);
builder.Services.AddPlatformRedisCache(builder.Configuration);
builder.Services.AddPlatformEventBus(builder.Configuration); // Task 6: pass configureConsumers
builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

// Task 5–6 add here: INetworkAssetRepository, AssetIntegrationEventMapper (IIntegrationEventMapper),
// AddOutboxDomainEventTypesFromAssembly(typeof(AssetRegistered).Assembly).

var app = builder.Build();

app.UsePlatformWebApi();
app.MapHealthChecks("/health");
app.MapEndpointModules(app.Services, typeof(Program).Assembly);

app.Run();

public partial class Program;
```

`appsettings.json` — copy GIS's, changing service-name/db/producer and dropping the `GisQuery` block:
```json
{
  "ServiceName": "water-network-asset-be",
  "ConnectionStrings": { "PostgreSQL": "Host=localhost;Port=5432;Database=wn_asset;Username=postgres;Password=postgres", "Redis": "" },
  "EventBus": { "Producer": "water-network-asset-be", "Transport": "RabbitMq" },
  "MassTransit": { "RabbitMq": { "Host": "localhost", "Username": "guest", "Password": "guest" } },
  "MultiTenancy": { "AllowHeaderFallback": true },
  "Jwt": { "Mode": "Mock" },
  "Outbox": { "BatchSize": 20, "MaxRetries": 5, "PollingIntervalSeconds": 5 },
  "Database": { "ApplyMigrationsOnStartup": false },
  "Serilog": { "MinimumLevel": { "Default": "Information" } }
}
```
`appsettings.Development.json` and `Properties/launchSettings.json`: copy GIS's verbatim (launchSettings may keep GIS ports or change to 5057/7262 — cosmetic, choose new ports to avoid clashes when both run locally).

`Dockerfile` — copy GIS's, swap the project path/dll:
```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/ src/
RUN dotnet publish src/services/water-network-asset-be/src/WaterNetwork.Asset.Api -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "WaterNetwork.Asset.Api.dll"]
```

`WaterNetwork.Asset.slnx` — mirror GIS's structure with all 5 src + 3 test projects.

- [ ] **Step 2: Create the integration-test project + AssetApiFactory + failing health-check test**

`WaterNetwork.Asset.IntegrationTests.csproj` (mirror GIS's; references Api + Testing + Security building-blocks):
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
    <NoWarn>$(NoWarn);CA1707;CA1822;CA1852;CA2211</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="coverlet.collector" />
    <PackageReference Include="MassTransit" />
  </ItemGroup>
  <ItemGroup><Using Include="Xunit" /></ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/WaterNetwork.Asset.Api/WaterNetwork.Asset.Api.csproj" />
    <ProjectReference Include="../../../water-network-gis-be/src/WaterNetwork.Gis.Contracts/WaterNetwork.Gis.Contracts.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Testing/WaterPlatform.BuildingBlocks.Testing.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Security/WaterPlatform.BuildingBlocks.Security.csproj" />
  </ItemGroup>
</Project>
```

`AssetApiFactory.cs` (mirror `GisApiFactory`; default transport `InMemory` so most tests are broker-free):
```csharp
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public sealed class AssetApiFactory(PostgisFixture postgis) : WebApplicationFactory<Program>
{
    // Allow a test to override config (e.g. real RabbitMQ in the e2e test).
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
        scope.ServiceProvider.GetRequiredService<AssetDbContext>().Database.Migrate();
        return host;
    }
}
```
> `PostgisFixture` uses the `postgis/postgis` image but plain Postgres features work fine; reusing it avoids a second fixture type. asset-be never calls PostGIS functions.

`HealthCheckTests.cs`:
```csharp
using System.Net;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public class HealthCheckTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task Health_Endpoint_Returns_Ok()
    {
        await using var factory = new AssetApiFactory(postgis);
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
```

- [ ] **Step 3: Run the health-check test to verify it FAILS (no migration yet → `Migrate()` throws or build fails)**

Run: `dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/WaterNetwork.Asset.IntegrationTests.csproj`
Expected: FAIL — at this point there is no migration so `Database.Migrate()` on an empty model produces no asset tables but the platform (outbox/idempotency/processed) configs DO migrate; the health check itself should pass once the app boots. If it fails to **build** because `NetworkAssetPersistenceModel` is referenced before Task 4, that is the expected red. (If you deferred the DbSet lines, the health test should already pass — that's acceptable; move on.)

- [ ] **Step 4: Make it build & boot green**

Ensure placeholder persistence models exist so the solution compiles, then re-run the health test.
Run: `dotnet build src/services/water-network-asset-be/WaterNetwork.Asset.slnx`
Then: `dotnet test …IntegrationTests …HealthCheckTests`
Expected: PASS (app boots, `/health` → 200).

- [ ] **Step 5: Commit**
```bash
git add src/services/water-network-asset-be
git commit -m "feat(asset): scaffold water-network-asset-be 5-project slice + health check (AST-1)"
```

---

### Task 2: Domain — `AssetType`, `AssetStatus`, `AssetLifecycleEntry`, `NetworkAsset`, `AssetRegistered`

**Files:**
- Create: `…/Domain/ValueObjects/AssetType.cs`, `…/Domain/ValueObjects/AssetStatus.cs`
- Create: `…/Domain/Entities/AssetLifecycleEntry.cs`
- Create: `…/Domain/DomainEvents/AssetRegistered.cs`
- Create: `…/Domain/Aggregates/NetworkAsset.cs`
- Create: `…/Domain/Repositories/INetworkAssetRepository.cs`
- Test: `tests/WaterNetwork.Asset.UnitTests/Domain/{AssetTypeTests,AssetStatusTests,NetworkAssetTests}.cs`

- [ ] **Step 1: Create the UnitTests project**

`WaterNetwork.Asset.UnitTests.csproj` (mirror `WaterNetwork.Gis.UnitTests.csproj`; references Domain + Application + Infrastructure + Contracts + FluentAssertions/xunit). Add to slnx.

- [ ] **Step 2: Write failing domain tests**

`AssetStatusTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Asset.Domain.ValueObjects;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class AssetStatusTests
{
    [Fact]
    public void Defines_Full_Lifecycle_State_Set()
    {
        Enum.GetNames<AssetStatus>().Should().BeEquivalentTo(
            "Registered", "Active", "UnderMaintenance", "Suspended", "Decommissioned");
    }
}
```

`AssetTypeTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Asset.Domain.ValueObjects;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class AssetTypeTests
{
    [Theory]
    [InlineData("network.node.registered", AssetType.Node)]
    [InlineData("network.pipe.registered", AssetType.Pipe)]
    [InlineData("network.device.installed", AssetType.Device)]
    public void FromGisEventType_Maps_Each_Registration_Event(string eventType, AssetType expected)
        => AssetTypeMapping.FromGisEventType(eventType).Should().Be(expected);

    [Fact]
    public void FromGisEventType_Returns_Null_For_Unknown_Event()
        => AssetTypeMapping.FromGisEventType("network.node.deleted").Should().BeNull();
}
```

`NetworkAssetTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterNetwork.Asset.Domain.ValueObjects;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class NetworkAssetTests
{
    [Fact]
    public void RegisterFromGis_Reuses_Gis_Id_And_Defaults_To_Active()
    {
        var asset = NetworkAsset.RegisterFromGis("node-abc", "tenant-1", AssetType.Node, "ND-001");

        asset.Id.Should().Be("node-abc");
        asset.TenantId.Should().Be("tenant-1");
        asset.AssetType.Should().Be(AssetType.Node);
        asset.AssetCode.Should().Be("ND-001");
        asset.Status.Should().Be(AssetStatus.Active);
        asset.Version.Should().Be(1); // one transition recorded
    }

    [Fact]
    public void RegisterFromGis_Records_Initial_Lifecycle_Entry()
    {
        var asset = NetworkAsset.RegisterFromGis("node-abc", "tenant-1", AssetType.Node, "ND-001");

        asset.LifecycleEntries.Should().ContainSingle();
        var entry = asset.LifecycleEntries.Single();
        entry.FromStatus.Should().Be(AssetStatus.Registered);
        entry.ToStatus.Should().Be(AssetStatus.Active);
        entry.Reason.Should().Be("gis-registration");
    }

    [Fact]
    public void RegisterFromGis_Raises_AssetRegistered_Domain_Event()
    {
        var asset = NetworkAsset.RegisterFromGis("node-abc", "tenant-1", AssetType.Node, "ND-001");

        var evt = asset.GetDomainEvents().OfType<AssetRegistered>().Single();
        evt.AggregateId.Should().Be("node-abc");
        evt.EventType.Should().Be("AssetRegistered");
        evt.Data.TenantId.Should().Be("tenant-1");
        evt.Data.AssetType.Should().Be("Node");
        evt.Data.AssetCode.Should().Be("ND-001");
        evt.Data.Status.Should().Be("Active");
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `dotnet test …UnitTests`
Expected: FAIL — types not defined.

- [ ] **Step 4: Implement the domain**

`AssetStatus.cs`:
```csharp
namespace WaterNetwork.Asset.Domain.ValueObjects;

public enum AssetStatus
{
    Registered,
    Active,
    UnderMaintenance,
    Suspended,
    Decommissioned
}
```

`AssetType.cs` (enum + a mapping helper keyed off the GIS event-type constants):
```csharp
namespace WaterNetwork.Asset.Domain.ValueObjects;

public enum AssetType
{
    Node,
    Pipe,
    Device
}

/// <summary>
/// Maps a GIS registration integration-event type string to the asset profile type.
/// Kept in Domain (no GIS dependency) using the literal event-type strings so the
/// Infrastructure consumer and the Domain stay in sync without a cross-assembly constant.
/// </summary>
public static class AssetTypeMapping
{
    public static AssetType? FromGisEventType(string gisEventType) => gisEventType switch
    {
        "network.node.registered" => AssetType.Node,
        "network.pipe.registered" => AssetType.Pipe,
        "network.device.installed" => AssetType.Device,
        _ => null
    };
}
```

`AssetLifecycleEntry.cs`:
```csharp
using WaterNetwork.Asset.Domain.ValueObjects;

namespace WaterNetwork.Asset.Domain.Entities;

/// <summary>Append-only audit record of a single lifecycle transition.</summary>
public sealed class AssetLifecycleEntry
{
    public AssetStatus FromStatus { get; }
    public AssetStatus ToStatus { get; }
    public string ActorId { get; }
    public string? Reason { get; }
    public DateTime OccurredAt { get; }

    public AssetLifecycleEntry(AssetStatus fromStatus, AssetStatus toStatus, string actorId, string? reason, DateTime occurredAt)
    {
        FromStatus = fromStatus;
        ToStatus = toStatus;
        ActorId = actorId;
        Reason = reason;
        OccurredAt = occurredAt;
    }
}
```

`AssetRegistered.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.Domain.DomainEvents;

public sealed record AssetRegisteredData(
    string TenantId,
    string AssetType,
    string AssetCode,
    string Status);

public sealed record AssetRegistered(
    string AggregateId,
    AssetRegisteredData Data)
    : DomainEventBase<AssetRegisteredData>(
        aggregateId: AggregateId,
        aggregateType: "NetworkAsset",
        eventType: "AssetRegistered",
        data: Data);
```

`NetworkAsset.cs`:
```csharp
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterNetwork.Asset.Domain.Entities;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Asset.Domain.Aggregates;

public sealed class NetworkAsset : AggregateRoot
{
    private readonly List<AssetLifecycleEntry> _lifecycleEntries = [];

    public string TenantId { get; private set; }
    public AssetType AssetType { get; private set; }
    public string AssetCode { get; private set; }
    public AssetStatus Status { get; private set; }
    public IReadOnlyList<AssetLifecycleEntry> LifecycleEntries => _lifecycleEntries.AsReadOnly();

    private NetworkAsset(
        string id, string tenantId, AssetType assetType, string assetCode, AssetStatus status,
        int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        AssetType = assetType;
        AssetCode = assetCode;
        Status = status;
    }

    /// <summary>
    /// Creates an asset profile from a GIS registration event. The id is the GIS asset id
    /// (shared key → natural idempotency). Default business status is Active (US-P1-05),
    /// recorded as a Registered→Active transition.
    /// </summary>
    public static NetworkAsset RegisterFromGis(string assetId, string tenantId, AssetType assetType, string assetCode)
    {
        var asset = new NetworkAsset(assetId, tenantId, assetType, assetCode, AssetStatus.Active);
        asset._lifecycleEntries.Add(new AssetLifecycleEntry(
            AssetStatus.Registered, AssetStatus.Active, actorId: "system", reason: "gis-registration", occurredAt: DateTime.UtcNow));
        asset.MarkAsModified(); // Version 0 → 1; one event raised, so repository expectedVersion = 0 on insert

        asset.AddDomainEvent(new AssetRegistered(asset.Id, new AssetRegisteredData(
            TenantId: tenantId,
            AssetType: assetType.ToString(),
            AssetCode: assetCode,
            Status: AssetStatus.Active.ToString())));
        return asset;
    }

    public static NetworkAsset Reconstitute(
        string id, string tenantId, AssetType assetType, string assetCode, AssetStatus status,
        int version, DateTime createdAt, DateTime updatedAt, IEnumerable<AssetLifecycleEntry> lifecycleEntries)
    {
        var asset = new NetworkAsset(id, tenantId, assetType, assetCode, status, version, createdAt, updatedAt);
        asset._lifecycleEntries.AddRange(lifecycleEntries);
        return asset;
    }
}
```
> **Version bookkeeping check:** `AggregateRepositoryBase.SaveAsync` computes `expectedVersion = Version - events.Count`. `RegisterFromGis` raises 1 event and bumps Version to 1 → `expectedVersion = 0` on insert, matching the "no prior row" sentinel in the repository (Task 4). Mirror `NetworkNodeRepository`'s insert check.

`INetworkAssetRepository.cs`:
```csharp
using WaterNetwork.Asset.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Asset.Domain.Repositories;

public interface INetworkAssetRepository : IAggregateRepository<NetworkAsset>
{
    Task<bool> ExistsAsync(string assetId, CancellationToken ct = default);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test …UnitTests`
Expected: PASS (all domain tests green).

- [ ] **Step 6: Commit**
```bash
git add src/services/water-network-asset-be/src/WaterNetwork.Asset.Domain \
        src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests
git commit -m "feat(asset): NetworkAsset aggregate + lifecycle + AssetRegistered domain event (AST-1)"
```

---

### Task 3: Contracts — `AssetEventTypes` + `AssetRegisteredV1` + contract test

**Files:**
- Create: `…/Contracts/AssetEventTypes.cs`, `…/Contracts/Events/AssetRegisteredV1.cs`
- Test: `tests/WaterNetwork.Asset.ContractTests/{WaterNetwork.Asset.ContractTests.csproj, AssetRegisteredContractTests.cs}`

- [ ] **Step 1: Create the ContractTests project** (mirror `WaterNetwork.Gis.ContractTests.csproj`; references Contracts + Infrastructure). Add to slnx.

- [ ] **Step 2: Write the failing contract test**

`AssetRegisteredContractTests.cs`:
```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;

namespace WaterNetwork.Asset.ContractTests;

public class AssetRegisteredContractTests
{
    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        var evt = new AssetRegisteredV1("node-1", "tenant-1", "Node", "ND-001", "Active");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().BeEquivalentTo("AssetId", "TenantId", "AssetType", "AssetCode", "Status");
    }

    [Fact]
    public void EventType_Is_Fixed()
        => AssetEventTypes.AssetRegistered.Should().Be("asset.registered");
}
```

- [ ] **Step 3: Run to verify fail.** Run: `dotnet test …ContractTests` → FAIL (types missing).

- [ ] **Step 4: Implement contracts**

`AssetEventTypes.cs`:
```csharp
namespace WaterNetwork.Asset.Contracts;

public static class AssetEventTypes
{
    public const string AssetRegistered = "asset.registered";
    // AST-2 adds: asset.activated, asset.maintenance-marked, asset.status.changed, asset.decommissioned, …
}
```

`AssetRegisteredV1.cs`:
```csharp
namespace WaterNetwork.Asset.Contracts.Events;

/// <summary>
/// v1 payload for the <c>asset.registered</c> integration event. Emitted when a GIS asset
/// (node/pipe/device) first becomes a tracked asset profile. <c>AssetId</c> equals the GIS asset id.
/// </summary>
public sealed record AssetRegisteredV1(
    string AssetId,
    string TenantId,
    string AssetType,
    string AssetCode,
    string Status);
```

- [ ] **Step 5: Run to verify pass.** Run: `dotnet test …ContractTests` → PASS.

- [ ] **Step 6: Commit**
```bash
git add src/services/water-network-asset-be/src/WaterNetwork.Asset.Contracts \
        src/services/water-network-asset-be/tests/WaterNetwork.Asset.ContractTests
git commit -m "feat(asset): asset.registered v1 contract + contract test (AST-1)"
```

---

### Task 4: Infrastructure persistence — models, EF configs, repository, migration

**Files:**
- Create: `…/Infrastructure/Persistence/NetworkAssetPersistenceModel.cs`, `…/AssetLifecycleEntryPersistenceModel.cs`
- Create: `…/Infrastructure/Persistence/Configurations/{NetworkAssetConfiguration,AssetLifecycleEntryConfiguration}.cs`
- Modify: `…/Infrastructure/Persistence/AssetDbContext.cs` (replace placeholder DbSets if deferred)
- Create: `…/Infrastructure/Repositories/NetworkAssetRepository.cs`
- Create: `…/Infrastructure/Persistence/Migrations/*` (generated)
- Test: `tests/…IntegrationTests/NetworkAssetRepositoryTests.cs`

- [ ] **Step 1: Write the failing repository round-trip test**

`NetworkAssetRepositoryTests.cs`:
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

public class NetworkAssetRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task SaveAsync_Then_GetById_RoundTrips_Profile_And_Lifecycle()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
        await db.Database.MigrateAsync();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();

        var id = $"node-{Guid.CreateVersion7():N}";
        var asset = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, "ND-001");
        await repo.SaveAsync(asset);

        (await repo.ExistsAsync(id)).Should().BeTrue();
        var reloaded = await repo.GetByIdAsync(id);
        reloaded.Should().NotBeNull();
        reloaded!.Status.Should().Be(AssetStatus.Active);
        reloaded.AssetType.Should().Be(AssetType.Node);
        reloaded.LifecycleEntries.Should().ContainSingle();

        // Outbox row written in the same transaction.
        var outbox = await db.OutboxEntries.FirstOrDefaultAsync(e => e.AggregateId == id && e.EventType == "AssetRegistered");
        outbox.Should().NotBeNull();
    }
}
```

- [ ] **Step 2: Run to verify fail.** Run: `dotnet test …IntegrationTests …NetworkAssetRepositoryTests` → FAIL (no repository registered / no tables).

- [ ] **Step 3: Implement persistence models + configs**

`NetworkAssetPersistenceModel.cs`:
```csharp
namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class NetworkAssetPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string AssetType { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public string Status { get; set; } = default!;
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<AssetLifecycleEntryPersistenceModel> LifecycleEntries { get; set; } = [];
}
```

`AssetLifecycleEntryPersistenceModel.cs`:
```csharp
namespace WaterNetwork.Asset.Infrastructure.Persistence;

public sealed class AssetLifecycleEntryPersistenceModel
{
    public long Id { get; set; }              // surrogate identity
    public string AssetId { get; set; } = default!;
    public string FromStatus { get; set; } = default!;
    public string ToStatus { get; set; } = default!;
    public string ActorId { get; set; } = default!;
    public string? Reason { get; set; }
    public DateTime OccurredAt { get; set; }
}
```

`NetworkAssetConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Asset.Infrastructure.Persistence.Configurations;

public sealed class NetworkAssetConfiguration : IEntityTypeConfiguration<NetworkAssetPersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkAssetPersistenceModel> builder)
    {
        builder.ToTable("network_assets");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetType).HasColumnName("asset_type").HasMaxLength(16).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.AssetCode })
            .IsUnique().HasDatabaseName("ux_network_assets_tenant_asset_code");

        builder.HasMany(x => x.LifecycleEntries)
            .WithOne()
            .HasForeignKey(x => x.AssetId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
```

`AssetLifecycleEntryConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Asset.Infrastructure.Persistence.Configurations;

public sealed class AssetLifecycleEntryConfiguration : IEntityTypeConfiguration<AssetLifecycleEntryPersistenceModel>
{
    public void Configure(EntityTypeBuilder<AssetLifecycleEntryPersistenceModel> builder)
    {
        builder.ToTable("asset_lifecycle_entries");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedOnAdd();
        builder.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.FromStatus).HasColumnName("from_status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.ToStatus).HasColumnName("to_status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.ActorId).HasColumnName("actor_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Reason).HasColumnName("reason").HasMaxLength(256);
        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at");
        builder.HasIndex(x => x.AssetId).HasDatabaseName("ix_asset_lifecycle_entries_asset_id");
    }
}
```

Ensure `AssetDbContext` exposes both DbSets + `ApplyConfigurationsFromAssembly` (from Task 1).

- [ ] **Step 4: Implement the repository**

`NetworkAssetRepository.cs` (mirror `NetworkNodeRepository`'s insert/update staging + concurrency check):
```csharp
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Entities;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Asset.Infrastructure.Repositories;

public sealed class NetworkAssetRepository(
    AssetDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkAsset>(dbContext, eventDispatcher, outboxRepository), INetworkAssetRepository
{
    public async Task<bool> ExistsAsync(string assetId, CancellationToken ct = default)
        => await dbContext.NetworkAssets.AnyAsync(x => x.Id == assetId, ct);

    public override async Task<NetworkAsset?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkAssets
            .AsNoTracking()
            .Include(x => x.LifecycleEntries)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        return model is null ? null : ToDomain(model);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Assets are decommissioned via lifecycle commands (AST-2), not deleted.");

    protected override async Task PersistAsync(NetworkAsset aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.NetworkAssets
            .Include(x => x.LifecycleEntries)
            .FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);

        if (existing is null)
        {
            if (expectedVersion > 0)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            dbContext.NetworkAssets.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);

            existing.Status = aggregate.Status.ToString();
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
            // AST-1 only appends entries on insert; AST-2 lifecycle commands will append here.
        }
    }

    private static NetworkAssetPersistenceModel ToModel(NetworkAsset a) => new()
    {
        Id = a.Id,
        TenantId = a.TenantId,
        AssetType = a.AssetType.ToString(),
        AssetCode = a.AssetCode,
        Status = a.Status.ToString(),
        Version = a.Version,
        CreatedAt = a.CreatedAt,
        UpdatedAt = a.UpdatedAt,
        LifecycleEntries = a.LifecycleEntries.Select(e => new AssetLifecycleEntryPersistenceModel
        {
            AssetId = a.Id,
            FromStatus = e.FromStatus.ToString(),
            ToStatus = e.ToStatus.ToString(),
            ActorId = e.ActorId,
            Reason = e.Reason,
            OccurredAt = e.OccurredAt
        }).ToList()
    };

    private static NetworkAsset ToDomain(NetworkAssetPersistenceModel m)
        => NetworkAsset.Reconstitute(
            m.Id, m.TenantId, Enum.Parse<AssetType>(m.AssetType), m.AssetCode, Enum.Parse<AssetStatus>(m.Status),
            m.Version, m.CreatedAt, m.UpdatedAt,
            m.LifecycleEntries.Select(e => new AssetLifecycleEntry(
                Enum.Parse<AssetStatus>(e.FromStatus), Enum.Parse<AssetStatus>(e.ToStatus),
                e.ActorId, e.Reason, e.OccurredAt)));
}
```

Register in `Program.cs`:
```csharp
builder.Services.AddScoped<INetworkAssetRepository, NetworkAssetRepository>();
```

- [ ] **Step 5: Generate the InitialCreate migration**

Run (needs `dotnet-ef`; install if missing: `dotnet tool install --global dotnet-ef`):
```bash
dotnet ef migrations add InitialCreate \
  -p src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure/WaterNetwork.Asset.Infrastructure.csproj \
  -s src/services/water-network-asset-be/src/WaterNetwork.Asset.Api/WaterNetwork.Asset.Api.csproj \
  -o Persistence/Migrations
```
Expected: generates `*_InitialCreate.cs` containing `network_assets`, `asset_lifecycle_entries`, **plus** `outbox_entries`, `idempotency_entries`, `processed_events` (inherited from `PlatformDbContext`). Verify those 5 tables are present.

- [ ] **Step 6: Run the repository test to verify it passes**

Run: `dotnet test …IntegrationTests …NetworkAssetRepositoryTests`
Expected: PASS (round-trip + outbox row).

- [ ] **Step 7: Commit**
```bash
git add src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure \
        src/services/water-network-asset-be/src/WaterNetwork.Asset.Api/Program.cs \
        src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests
git commit -m "feat(asset): persistence + NetworkAssetRepository + InitialCreate migration (AST-1)"
```

---

### Task 5: Outbox integration-event mapper for `asset.registered`

**Files:**
- Create: `…/Infrastructure/IntegrationEvents/AssetIntegrationEventMapper.cs`
- Modify: `…/Api/Program.cs` (register mapper + `AddOutboxDomainEventTypesFromAssembly`)
- Test: `tests/…IntegrationTests/OutboxPublishPipelineTests.cs`

- [ ] **Step 1: Write the failing outbox-pipeline test** (mirror GIS `OutboxPublishPipelineTests`, capturing publisher, PostGIS only):
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

public class OutboxPublishPipelineTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private sealed class CapturingPublisher : IIntegrationEventPublisher
    {
        public List<IIntegrationEvent> Published { get; } = [];
        public Task PublishAsync(IIntegrationEvent e, CancellationToken ct = default) { Published.Add(e); return Task.CompletedTask; }
    }

    [Fact]
    public async Task OutboxProcessor_Publishes_Typed_AssetRegistered_Event()
    {
        var publisher = new CapturingPublisher();
        await using var factory = new AssetApiFactory(postgis).WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            foreach (var d in s.Where(x => x.ServiceType == typeof(IIntegrationEventPublisher)).ToList()) s.Remove(d);
            s.AddSingleton<IIntegrationEventPublisher>(publisher);
        }));

        string id = $"node-{Guid.CreateVersion7():N}";
        using (var scope = factory.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<AssetDbContext>().Database.MigrateAsync();
            var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
            await repo.SaveAsync(NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, "ND-001"));
        }
        using (var scope = factory.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IOutboxProcessor>().ProcessOutboxAsync(CancellationToken.None);

        var published = publisher.Published.Where(e => e.SourceAggregateId == id).ToList();
        published.Should().ContainSingle();
        published[0].EventType.Should().Be(AssetEventTypes.AssetRegistered);
        published[0].GetType().Name.Should().Be("AssetRegisteredIntegrationEvent");

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
            var entry = await db.OutboxEntries.FirstAsync(e => e.AggregateId == id && e.EventType == "AssetRegistered");
            entry.Status.Should().Be(OutboxEntryStatus.Processed);
        }
    }
}
```

- [ ] **Step 2: Run to verify fail.** Run → FAIL (mapper not registered → outbox entry goes Failed/unmapped).

- [ ] **Step 3: Implement the mapper** (mirror `GisIntegrationEventMapper`, single event):
```csharp
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Asset.Infrastructure.IntegrationEvents;

public sealed record AssetRegisteredIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, AssetRegisteredV1 Data)
    : IIntegrationEvent<AssetRegisteredV1>;

public sealed class AssetIntegrationEventMapper : IIntegrationEventMapper
{
    private static readonly Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry =
        new(StringComparer.Ordinal)
        {
            ["AssetRegistered"] = e => e is AssetRegistered a ? MapAssetRegistered(a) : null,
        };

    public bool CanMap(string eventType) => Registry.ContainsKey(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
        => Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null;

    private static AssetRegisteredIntegrationEvent MapAssetRegistered(AssetRegistered e)
        => new(
            EventId: e.EventId,
            EventType: AssetEventTypes.AssetRegistered,
            EventVersion: 1,
            OccurredAt: e.OccurredAt,
            SourceAggregateId: e.AggregateId,
            SourceAggregateType: e.AggregateType,
            Data: new AssetRegisteredV1(e.AggregateId, e.Data.TenantId, e.Data.AssetType, e.Data.AssetCode, e.Data.Status));
}
```

Register in `Program.cs` (mapper AFTER the fallback so it wins `LastOrDefault(CanMap)`, plus the type resolver):
```csharp
builder.Services.AddSingleton<IIntegrationEventMapper, AssetIntegrationEventMapper>();
builder.Services.AddOutboxDomainEventTypesFromAssembly(
    typeof(WaterNetwork.Asset.Domain.DomainEvents.AssetRegistered).Assembly);
```

- [ ] **Step 4: Run to verify pass.** Run → PASS.

- [ ] **Step 5: Add an outbox-registry contract test** (mirror GIS `OutboxEventTypeRegistryContractTests` — assert `AssetRegistered` is resolvable). Put in ContractTests project:
```csharp
using FluentAssertions;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Asset.ContractTests;

public class OutboxEventTypeRegistryContractTests
{
    [Fact]
    public void AssetRegistered_EventType_Matches_Type_Name()
    {
        // OutboxProcessor resolves by Type.Name; the domain event's EventType string must equal it.
        typeof(AssetRegistered).Name.Should().Be("AssetRegistered");
        var data = new AssetRegisteredData("t", "Node", "ND-001", "Active");
        new AssetRegistered("node-1", data).EventType.Should().Be("AssetRegistered");
    }
}
```
Run: `dotnet test …ContractTests` → PASS.

- [ ] **Step 6: Commit**
```bash
git add src/services/water-network-asset-be
git commit -m "feat(asset): outbox mapper publishes asset.registered + type registry (AST-1)"
```

---

### Task 6: The consumer — `IConsumer<IntegrationEventEnvelope>` + DI wiring

**Files:**
- Create: `…/Infrastructure/Consumers/GisAssetRegistrationConsumer.cs`
- Modify: `…/Api/Program.cs` (`AddPlatformEventBus(..., configureConsumers)`)
- Test: `tests/…IntegrationTests/GisAssetRegistrationConsumerTests.cs`

> **Design (recorded in decision 0011, Task 8):** the consumer subscribes to the envelope, exposes a broker-free `HandleEnvelopeAsync` core for deterministic testing, filters by `EventType` via `AssetTypeMapping`, deserializes `envelope.Payload`'s `Data` element into the matching GIS `*.V1` record, dedupes by `envelope.EventId` through `IInboxMessageStore` (consumer name `"asset.gis-registration"`), and is idempotent on the shared PK (re-delivery of an already-created asset is a no-op success).

- [ ] **Step 1: Write the failing consumer tests** (PostGIS only; drive `HandleEnvelopeAsync` directly):
```csharp
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Asset.Infrastructure.Consumers;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

public class GisAssetRegistrationConsumerTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static IntegrationEventEnvelope EnvelopeFor(string eventId, string eventType, object concreteEvent) =>
        new(eventId, eventType, 1, DateTime.UtcNow, null, null, null, null, null,
            "water-network-gis-be", JsonSerializer.Serialize(concreteEvent));

    // Mirrors the wire shape produced by MassTransitIntegrationEventPublisher: { …, Data: <V1> }.
    private static object NodeRegisteredConcrete(string id) => new
    {
        EventId = Guid.NewGuid().ToString(), EventType = "network.node.registered", EventVersion = 1,
        OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkNode",
        Data = new NetworkNodeRegisteredV1(id, "tenant-1", "ND-001", "Junction", 10.7, 106.6)
    };

    private static async Task<(AssetApiFactory f, IServiceScope s)> BootAsync()
    {
        var f = new AssetApiFactory(postgis);
        var s = f.Services.CreateScope();
        await s.ServiceProvider.GetRequiredService<AssetDbContext>().Database.MigrateAsync();
        return (f, s);
    }

    [Theory]
    [InlineData("network.node.registered", AssetType.Node)]
    [InlineData("network.pipe.registered", AssetType.Pipe)]
    [InlineData("network.device.installed", AssetType.Device)]
    public async Task Creates_Profile_For_Each_Registration_Event(string eventType, AssetType expected)
    {
        var (f, scope) = await BootAsync();
        await using var _ = f; using var __ = scope;
        var id = $"asset-{Guid.NewGuid():N}";
        object concrete = eventType switch
        {
            "network.node.registered" => NodeRegisteredConcrete(id),
            "network.pipe.registered" => new { EventId = Guid.NewGuid().ToString(), EventType = eventType, EventVersion = 1,
                OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkPipe",
                Data = new NetworkPipeRegisteredV1(id, "tenant-1", "PP-001", "n1", "n2", 12.5, 150, "PVC") },
            _ => new { EventId = Guid.NewGuid().ToString(), EventType = eventType, EventVersion = 1,
                OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkDevice",
                Data = new NetworkDeviceInstalledV1(id, "tenant-1", "DV-001", "Valve", null, "n1", 10.7, 106.6) }
        };

        var consumer = scope.ServiceProvider.GetRequiredService<GisAssetRegistrationConsumer>();
        await consumer.HandleEnvelopeAsync(EnvelopeFor(Guid.NewGuid().ToString(), eventType, concrete), default);

        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var asset = await repo.GetByIdAsync(id);
        asset.Should().NotBeNull();
        asset!.AssetType.Should().Be(expected);
        asset.Status.Should().Be(AssetStatus.Active);
    }

    [Fact]
    public async Task Ignores_Unsubscribed_Event_Type()
    {
        var (f, scope) = await BootAsync();
        await using var _ = f; using var __ = scope;
        var consumer = scope.ServiceProvider.GetRequiredService<GisAssetRegistrationConsumer>();
        var env = EnvelopeFor(Guid.NewGuid().ToString(), "network.node.deleted",
            new { EventId = Guid.NewGuid().ToString(), Data = new { NodeId = "x" } });

        var act = async () => await consumer.HandleEnvelopeAsync(env, default);
        await act.Should().NotThrowAsync();
        (await scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>().ExistsAsync("x")).Should().BeFalse();
    }

    [Fact]
    public async Task Deliver_Twice_Same_EventId_Creates_One_Profile()
    {
        var (f, scope) = await BootAsync();
        await using var _ = f; using var __ = scope;
        var id = $"node-{Guid.NewGuid():N}";
        var env = EnvelopeFor("evt-fixed-1", "network.node.registered", NodeRegisteredConcrete(id));
        var consumer = scope.ServiceProvider.GetRequiredService<GisAssetRegistrationConsumer>();

        await consumer.HandleEnvelopeAsync(env, default);
        await consumer.HandleEnvelopeAsync(env, default); // redelivery

        var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
        (await db.NetworkAssets.CountAsync(x => x.Id == id)).Should().Be(1);
    }
}
```
Add `using Microsoft.EntityFrameworkCore;` for the final `CountAsync`.

- [ ] **Step 2: Run to verify fail.** Run → FAIL (consumer type missing / not registered).

- [ ] **Step 3: Implement the consumer**
```csharp
using System.Text.Json;
using MassTransit;
using Microsoft.Extensions.Logging;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Asset.Infrastructure.Consumers;

/// <summary>
/// Consumes the platform <see cref="IntegrationEventEnvelope"/> and materialises an asset profile
/// for each GIS registration event. First consumer in the platform — see decision 0011.
/// </summary>
public sealed class GisAssetRegistrationConsumer(
    INetworkAssetRepository repository,
    IInboxMessageStore inbox,
    ILogger<GisAssetRegistrationConsumer> logger)
    : IConsumer<IntegrationEventEnvelope>
{
    private const string ConsumerName = "asset.gis-registration";

    public Task Consume(ConsumeContext<IntegrationEventEnvelope> context)
        => HandleEnvelopeAsync(context.Message, context.CancellationToken);

    /// <summary>Broker-free core so the behaviour is unit/integration-testable without MassTransit.</summary>
    public async Task HandleEnvelopeAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        var assetType = AssetTypeMapping.FromGisEventType(envelope.EventType);
        if (assetType is null) return; // not a registration event we subscribe to → ignore

        if (await inbox.HasBeenProcessedAsync(ConsumerName, envelope.EventId, ct))
            return;

        var (assetId, tenantId, assetCode) = ExtractIdentity(envelope, assetType.Value);

        // PK == GIS id → natural idempotency. Pre-check avoids a guaranteed unique-violation on redelivery.
        if (!await repository.ExistsAsync(assetId, ct))
        {
            try
            {
                await repository.SaveAsync(
                    NetworkAsset.RegisterFromGis(assetId, tenantId, assetType.Value, assetCode), ct);
            }
            catch (Exception ex) when (IsUniqueViolation(ex))
            {
                // Concurrent delivery of the same event raced us to the insert — already created, treat as success.
                logger.LogDebug(ex, "Asset {AssetId} already created by a concurrent consumer; continuing.", assetId);
            }
        }

        await inbox.MarkAsProcessedAsync(ConsumerName, envelope.EventId, ct);
    }

    private static (string assetId, string tenantId, string assetCode) ExtractIdentity(
        IntegrationEventEnvelope envelope, AssetType assetType)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var data = doc.RootElement.GetProperty("Data");
        return assetType switch
        {
            AssetType.Node => Read<NetworkNodeRegisteredV1>(data, d => (d.NodeId, d.TenantId, d.AssetCode)),
            AssetType.Pipe => Read<NetworkPipeRegisteredV1>(data, d => (d.PipeId, d.TenantId, d.AssetCode)),
            AssetType.Device => Read<NetworkDeviceInstalledV1>(data, d => (d.DeviceId, d.TenantId, d.AssetCode)),
            _ => throw new InvalidOperationException($"Unhandled asset type {assetType}")
        };
    }

    private static (string, string, string) Read<T>(JsonElement data, Func<T, (string, string, string)> select)
        => select(data.Deserialize<T>()
                  ?? throw new InvalidOperationException($"Envelope payload Data did not deserialize to {typeof(T).Name}."));

    // Local PG 23505 detection. Mirror of Gis PostgresExceptionHelper; promote to a building block
    // when a 2nd service needs it (backlog follow-up).
    private static bool IsUniqueViolation(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException)
            if (e.GetType().FullName == "Npgsql.PostgresException"
                && (string?)e.GetType().GetProperty("SqlState")?.GetValue(e) == "23505")
                return true;
        return false;
    }
}
```

Register the consumer + wire it into the bus in `Program.cs`:
```csharp
builder.Services.AddScoped<GisAssetRegistrationConsumer>();
builder.Services.AddPlatformEventBus(builder.Configuration, bus =>
{
    bus.AddConsumer<GisAssetRegistrationConsumer>();
});
```
Replace the earlier bare `AddPlatformEventBus(builder.Configuration);` from Task 1.

- [ ] **Step 4: Run to verify pass.** Run: `dotnet test …IntegrationTests …GisAssetRegistrationConsumerTests` → PASS (3 happy + ignore + deliver-twice).

- [ ] **Step 5: Commit**
```bash
git add src/services/water-network-asset-be
git commit -m "feat(asset): consume GIS registration envelope → create asset profile, inbox-idempotent (AST-1)"
```

---

### Task 7: Hero end-to-end test through real RabbitMQ (2 containers)

**Files:**
- Test: `tests/…IntegrationTests/GisRegistrationEndToEndTests.cs`

> Honors roadmap §5.4 AST-1: prove the path through **two real containers** (PostGIS + RabbitMQ). Publish a real `IntegrationEventEnvelope` to the broker (simulating GIS's outbox publish), let `asset-be`'s registered consumer process it, and poll `wn_asset` until the profile appears.

- [ ] **Step 1: Write the failing end-to-end test**
```csharp
using FluentAssertions;
using MassTransit;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Asset.IntegrationTests;

[Collection("real-broker")]
public class GisRegistrationEndToEndTests(PostgisFixture postgis, RabbitMqFixture rabbit)
    : IClassFixture<PostgisFixture>, IClassFixture<RabbitMqFixture>
{
    private AssetApiFactory CreateFactory()
    {
        var f = new AssetApiFactory(postgis);
        f.ConfigOverrides["EventBus:Transport"] = "RabbitMq";
        f.ConfigOverrides["MassTransit:RabbitMq:Host"] = rabbit.Host;
        f.ConfigOverrides["MassTransit:RabbitMq:Port"] = rabbit.Port.ToString();
        f.ConfigOverrides["MassTransit:RabbitMq:Username"] = rabbit.Username;
        f.ConfigOverrides["MassTransit:RabbitMq:Password"] = rabbit.Password;
        return f;
    }

    private static IntegrationEventEnvelope NodeEnvelope(string eventId, string id)
    {
        var concrete = new
        {
            EventId = eventId, EventType = "network.node.registered", EventVersion = 1,
            OccurredAt = DateTime.UtcNow, SourceAggregateId = id, SourceAggregateType = "NetworkNode",
            Data = new NetworkNodeRegisteredV1(id, "tenant-e2e", "ND-E2E", "Junction", 10.7, 106.6)
        };
        return new IntegrationEventEnvelope(eventId, "network.node.registered", 1, DateTime.UtcNow,
            null, null, null, null, null, "water-network-gis-be",
            System.Text.Json.JsonSerializer.Serialize(concrete));
    }

    private static async Task<bool> WaitForAssetAsync(AssetApiFactory f, string id, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
            if (await db.NetworkAssets.AnyAsync(x => x.Id == id)) return true;
            await Task.Delay(250);
        }
        return false;
    }

    [Fact]
    public async Task Publishing_NodeRegistered_To_Broker_Creates_Asset_Profile()
    {
        await using var factory = CreateFactory();
        _ = factory.Services; // boot host + bus + migrations
        var bus = factory.Services.GetRequiredService<IBus>();

        var id = $"node-{Guid.NewGuid():N}";
        await bus.Publish(NodeEnvelope($"evt-{Guid.NewGuid():N}", id));

        (await WaitForAssetAsync(factory, id, TimeSpan.FromSeconds(20)))
            .Should().BeTrue("the registered consumer should materialise the profile from the broker message");
    }

    [Fact]
    public async Task Delivering_Same_EventId_Twice_Creates_One_Profile()
    {
        await using var factory = CreateFactory();
        var bus = factory.Services.GetRequiredService<IBus>();

        var id = $"node-{Guid.NewGuid():N}";
        var eventId = $"evt-{Guid.NewGuid():N}";
        await bus.Publish(NodeEnvelope(eventId, id));
        await bus.Publish(NodeEnvelope(eventId, id)); // identical EventId

        (await WaitForAssetAsync(factory, id, TimeSpan.FromSeconds(20))).Should().BeTrue();
        await Task.Delay(1000); // allow any second delivery to be processed-then-deduped

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AssetDbContext>();
        (await db.NetworkAssets.CountAsync(x => x.Id == id)).Should().Be(1);
    }
}
```
Add the collection definition (prevents the two real-broker tests sharing a bus from racing the same queue):
```csharp
// CollectionFixtures.cs
using Xunit;
namespace WaterNetwork.Asset.IntegrationTests;

[CollectionDefinition("real-broker")]
public sealed class RealBrokerCollection : ICollectionFixture<PostgisFixture>, ICollectionFixture<RabbitMqFixture> { }
```
> If xUnit complains about combining `IClassFixture` and `ICollectionFixture` for the same types, drop the `IClassFixture<>` interfaces on the test class and rely solely on the collection's `ICollectionFixture<>` (constructor injection still works). Adjust to whichever the analyzer accepts; the goal is one shared PostGIS + one shared RabbitMQ across these tests.

- [ ] **Step 2: Run to verify fail first, then pass**

Run: `dotnet test …IntegrationTests …GisRegistrationEndToEndTests`
Expected: PASS once the consumer + bus wiring from Task 6 are in place. (If it fails on bus config keys, confirm `MassTransitConfiguration` reads `MassTransit:RabbitMq:Host/Username/Password` — it does; `Port` is not read by the building block, so if the Testcontainers RabbitMQ maps a non-default port, extend `MassTransitConfiguration.Host(...)` usage OR have the test publish through a bus pointed at `rabbit.ConnectionString`. **Verify the host wiring honors the mapped port**; if not, that is a building-block gap — note it and use the InMemory-transport e2e as the deterministic fallback while filing the port follow-up.)

> **Port caveat (resolve during execution):** `MassTransitConfiguration` currently calls `cfg.Host(host, vhost, …)` without a port, so it connects to 5672 — but `RabbitMqFixture` maps a random host port. Two clean options, pick one and note it in the PR: (a) add an optional `MassTransit:RabbitMq:Port` to `MassTransitConfiguration` (small building-block change, benefits every service) and use it here; or (b) keep AST-1 scoped and assert the end-to-end path with `EventBus:Transport=InMemory` (still exercises envelope→consumer→repo→outbox in one process), filing the real-broker port-config as an X-series follow-up. Prefer (a) if quick; the roadmap explicitly asked for real RabbitMQ.

- [ ] **Step 3: Commit**
```bash
git add src/services/water-network-asset-be
git commit -m "test(asset): end-to-end registration through real RabbitMQ + deliver-twice (AST-1)"
```

---

### Task 8: Decision record, event catalog, compose, docs, final verification

**Files:**
- Create: `docs/decisions/0011-integration-event-consume-convention.md`
- Create: `docs/conventions/event-catalog.md`
- Modify: `docker-compose.yml` (add `water-network-asset-be` service)
- Modify: `docs/stories/backlog.md` (Phase 1 status + AST-1 follow-ups)
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` (tick AST-1 in §3.3 / §5.4)
- Modify: `README.md` (add asset-be to service list if one exists)

- [ ] **Step 1: Write decision 0011** — content covers: the envelope-as-wire-type reality; why `IdempotentIntegrationEventConsumer<T>` doesn't fit the envelope; the adopted convention (subscribe to `IConsumer<IntegrationEventEnvelope>`, filter by `EventType`, deserialize `Payload.Data` into the producer's `*.Contracts` V1 record, dedupe by `EventId` via `IInboxMessageStore`, treat shared-PK re-insert as idempotent success); the cross-service dependency rule (Contracts-only); tenant-from-payload rule; and the two follow-ups (promote a reusable `IdempotentEnvelopeConsumer` base + `PostgresExceptionHelper` to building-blocks when GIS-5 adds the 2nd consumer). Follow the format of `docs/decisions/0010-gis-remove-event-naming.md`.

- [ ] **Step 2: Create `docs/conventions/event-catalog.md`** with a table: each `eventType`, version, producer, consumers, payload record, status. Seed it with `asset.registered` (producer asset-be; consumers: GIS-5 projection [future], BFF) and the three consumed GIS events (`network.node.registered`, `network.pipe.registered`, `network.device.installed`) marking asset-be as a consumer. Note that full GIS-producer backfill (deleted/relocated rows) is a US-X-03 follow-up.

- [ ] **Step 3: Add asset-be to `docker-compose.yml`** (mirror the gis-be block):
```yaml
  water-network-asset-be:
    build:
      context: .
      dockerfile: src/services/water-network-asset-be/Dockerfile
    ports: ["8082:8080"]
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - ConnectionStrings__PostgreSQL=Host=postgres;Port=5432;Database=wn_asset;Username=postgres;Password=postgres
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

- [ ] **Step 4: Update tracking docs** — in `backlog.md`, set Phase 1 to note AST-1 done and add an "AST-1 follow-ups" section (envelope-consumer base promotion; PostgresExceptionHelper promotion; real-broker port config if option (b) was taken; GIS-5 will consume `asset.status.changed`). Tick AST-1 in the roadmap §3.3 table and §5.4.

- [ ] **Step 5: Full verification — the slice gate**

Run each test project (per CLAUDE.md: `dotnet test` on `.slnx` silently runs 0 tests — run projects):
```bash
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests/WaterNetwork.Asset.UnitTests.csproj
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.ContractTests/WaterNetwork.Asset.ContractTests.csproj
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/WaterNetwork.Asset.IntegrationTests.csproj
```
Also confirm GIS still builds/tests green (the new project reference to `WaterNetwork.Gis.Contracts` must not perturb it):
```bash
dotnet build src/services/water-network-gis-be/WaterNetwork.Gis.slnx
```
Expected: all green, **0 warnings** (CLAUDE.md slice gate). Build the asset solution clean: `dotnet build src/services/water-network-asset-be/WaterNetwork.Asset.slnx -warnaserror`.

- [ ] **Step 6: Final commit (conventional)**
```bash
git add docs docker-compose.yml README.md
git commit -m "docs(asset): decision 0011 consume convention, event catalog, compose + tracking ticks (AST-1)"
```

---

## Self-Review (completed by plan author)

**Spec coverage (roadmap §5.4 AST-1 + §5.1–5.3):**
- Scaffold per recipe (slnx, 5 projects, `AssetDbContext : PlatformDbContext`, DB `wn_asset`, Dockerfile, compose) → Task 1 + Task 8 Step 3. ✓
- Inbox consumer for 3 GIS events → Task 6. ✓
- Minimal `NetworkAsset` aggregate → Task 2. ✓
- Migration `network_assets` + `asset_lifecycle_entries` → Task 4. ✓
- Publish `asset.registered` → Task 5. ✓
- End-to-end 2-container test (PostGIS + RabbitMQ); deliver-twice → 1 profile → Task 7 (+ deterministic layer in Task 6). ✓
- `assetId` shared with GIS id, default status Active (US-P1-05) → Task 2 `RegisterFromGis`. ✓
- Decision record for the first-consumer architecture choice → Task 8 Step 1. ✓
- Backfill risk (roadmap §5.5): **not implemented in AST-1** — recorded as a follow-up in Task 8 Step 4 (a one-time backfill script belongs to a later ops slice; greenfield risk ~0 because asset-be deploys alongside GIS). Flagged, not silently dropped.

**Placeholder scan:** No "TBD"/"add error handling" placeholders; every code step has complete code. The two genuine execution-time decisions (RabbitMQ mapped-port handling in Task 7; xUnit fixture-combination in Task 7 Step 1) are called out explicitly with concrete options, not left vague.

**Type consistency:** `NetworkAsset.RegisterFromGis(assetId, tenantId, AssetType, assetCode)`, `INetworkAssetRepository.ExistsAsync`, `AssetRegistered`/`AssetRegisteredData`, `AssetRegisteredV1(AssetId,TenantId,AssetType,AssetCode,Status)`, `AssetIntegrationEventMapper`/`AssetRegisteredIntegrationEvent`, `GisAssetRegistrationConsumer.HandleEnvelopeAsync`, consumer name `"asset.gis-registration"`, `AssetTypeMapping.FromGisEventType` — all names used consistently across Tasks 2–7. Version bookkeeping (`expectedVersion = 0` on insert) verified against `AggregateRepositoryBase`. Consumed V1 field names (`NodeId`/`PipeId`/`DeviceId`, all have `TenantId`+`AssetCode`) verified against the GIS contracts.
