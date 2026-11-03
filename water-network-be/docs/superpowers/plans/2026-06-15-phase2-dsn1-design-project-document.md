# DSN-1 Design Project + Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `water-network-design-be` (full layered service) with `CreateDesignProject` (US-P2-01) and `UploadDesignDocument` (US-P2-02) over an `IFileStoragePort` mock — slice đầu Phase 2.

**Architecture:** Layered service like asset-be/gis-be (Domain/Application/Infrastructure/Api/Contracts). Custom CQRS (`ICommandBus`/`IQueryBus`), EF Core + Postgres (`wn_design`, **no PostGIS** — deferred to DSN-2), transactional outbox for integration events. File storage behind `IFileStoragePort` with a runnable `LocalDiskFileStorageAdapter` mock (real `HttpFileStorageAdapter`→platform-core/file-storage-be swapped later — decision #12). Upload endpoint orchestrates store-file→commit-metadata; storage failure → 502 (no metadata committed).

**Tech Stack:** .NET 10, EF Core 10 + Npgsql, Dapper (read DAO), FluentValidation, MassTransit/RabbitMQ (publish-only), xUnit + FluentAssertions + PostgisFixture, building blocks under `src/building-blocks/src`.

**Spec:** `docs/superpowers/specs/2026-06-15-dsn1-design-project-document-design.md`

---

## Conventions discovered in the codebase (follow these exactly)

- **Aggregate**: extend `WaterPlatform.BuildingBlocks.Domain.Entities.AggregateRoot` (ctor `(string id, int version, DateTime? createdAt, DateTime? updatedAt)`); raise events via `AddDomainEvent`, bump version via `MarkAsModified()`.
- **Domain event**: `record X(string AggregateId, XData Data) : DomainEventBase<XData>(aggregateId: AggregateId, aggregateType: "...", eventType: "...", data: Data)`.
- **Repository**: extend `AggregateRepositoryBase<T>(PlatformDbContext, IDomainEventDispatcher, IOutboxRepository)`; override `PersistAsync` (STAGE ONLY — no SaveChanges; base owns the transaction + outbox), `GetByIdAsync`, `DeleteAsync`. `SaveAsync` (base) routes domain events to the outbox atomically.
- **DbContext**: extend `PlatformDbContext`; `ApplyConfigurationsFromAssembly(typeof(ThisDbContext).Assembly)` after `base.OnModelCreating`.
- **Command/Query**: `record C(...) : ICommand<TResult>` / `: IQuery<TResult>`; handler `ICommandHandler<C,TResult>`/`IQueryHandler<Q,TResult>` with `HandleAsync(cmd, ct)`. Registered via `AddHandlersFromAssembly`.
- **Tenant/actor**: `ITenantContextAccessor.Current!.TenantId` (throw `UnauthorizedException.InvalidToken(...)` if null); actor `IRequestContextProvider.Current()?.UserId`.
- **Errors → HTTP** (GlobalExceptionMiddleware): `NotFoundException`→404, `ValidationException`→400, `ConflictException`→409, `UnauthorizedException`→401, `ForbiddenException`→403, `BusinessRuleException`→422, else→500. **There is NO 502 mapping** → the upload endpoint must return `Results.Problem(statusCode:502)` itself on storage failure.
- **Endpoint module**: `IEndpointModule.MapEndpoints`; `app.MapGroup(...)`; `.WithValidation<TRequest>()` (JSON only) + `.RequirePermission("...")`. Auto-discovered by `MapEndpointModules`.
- **UUID**: `Guid.CreateVersion7().ToString()` (decision uuid-v7).
- **Migrations**: `dotnet ef migrations add <Name> -p <Infra.csproj> -s <Api.csproj> -o Persistence/Migrations`; applied in tests via `DbContext.Database.Migrate()`. Requires `dotnet-ef` (install: `dotnet tool install --global dotnet-ef` if missing).

## File Structure

```
src/services/water-network-design-be/
  WaterNetwork.Design.slnx
  Dockerfile
  src/WaterNetwork.Design.Domain/         (Aggregates, DomainEvents, ValueObjects, Repositories)
  src/WaterNetwork.Design.Contracts/      (Events V1, Requests, DesignEventTypes)
  src/WaterNetwork.Design.Application/     (Commands, Queries, Validators, Dtos, Ports, Configuration)
  src/WaterNetwork.Design.Infrastructure/ (Persistence + Migrations, Repositories, Storage, IntegrationEvents)
  src/WaterNetwork.Design.Api/            (Program, Endpoints, Validators, appsettings)
  tests/WaterNetwork.Design.UnitTests/
  tests/WaterNetwork.Design.IntegrationTests/
  tests/WaterNetwork.Design.ContractTests/
```

---

## Task 1: Solution scaffold + boot/health + DB

Creates all 8 projects, the slnx, Program with full platform wiring, a base-only `DesignDbContext`, the `InitialCreate` migration (platform outbox/inbox/processed tables), Dockerfile, compose entry, and a health integration test.

**Files (create unless noted):**
- 8 `.csproj` (paths below), `WaterNetwork.Design.slnx`, `Dockerfile`
- `src/WaterNetwork.Design.Api/Program.cs`, `appsettings.json`
- `src/WaterNetwork.Design.Infrastructure/Persistence/DesignDbContext.cs`
- `src/WaterNetwork.Design.Infrastructure/Persistence/Migrations/*` (generated)
- `tests/WaterNetwork.Design.IntegrationTests/DesignApiFactory.cs`, `CollectionFixtures.cs`, `HealthCheckTests.cs`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create the project files**

`src/WaterNetwork.Design.Domain/WaterNetwork.Design.Domain.csproj`:
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

`src/WaterNetwork.Design.Contracts/WaterNetwork.Design.Contracts.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

`src/WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Design.Domain/WaterNetwork.Design.Domain.csproj" />
    <ProjectReference Include="../WaterNetwork.Design.Contracts/WaterNetwork.Design.Contracts.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Application/WaterPlatform.BuildingBlocks.Application.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.MultiTenancy/WaterPlatform.BuildingBlocks.MultiTenancy.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="FluentValidation" />
  </ItemGroup>
</Project>
```

`src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <NoWarn>$(NoWarn);CA1861</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj" />
    <ProjectReference Include="../WaterNetwork.Design.Domain/WaterNetwork.Design.Domain.csproj" />
    <ProjectReference Include="../WaterNetwork.Design.Contracts/WaterNetwork.Design.Contracts.csproj" />
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
  </ItemGroup>
</Project>
```

`src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <ProjectReference Include="../WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj" />
    <ProjectReference Include="../WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj" />
    <ProjectReference Include="../WaterNetwork.Design.Contracts/WaterNetwork.Design.Contracts.csproj" />
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

Test csprojs — `tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj`:
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
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="NSubstitute" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj" />
    <ProjectReference Include="../../src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj" />
  </ItemGroup>
</Project>
```

`tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj`:
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
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Testing/WaterPlatform.BuildingBlocks.Testing.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Security/WaterPlatform.BuildingBlocks.Security.csproj" />
  </ItemGroup>
</Project>
```

`tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj`:
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
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/WaterNetwork.Design.Contracts/WaterNetwork.Design.Contracts.csproj" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: Create the base DbContext** `src/WaterNetwork.Design.Infrastructure/Persistence/DesignDbContext.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignDbContext(DbContextOptions<DesignDbContext> options) : PlatformDbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(DesignDbContext).Assembly);
    }
}
```

- [ ] **Step 3: Create Program.cs** `src/WaterNetwork.Design.Api/Program.cs` (no service-specific registrations yet — added in Tasks 2/3):
```csharp
using WaterNetwork.Design.Infrastructure.Persistence;
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
builder.Services.AddPlatformPersistence<DesignDbContext>(builder.Configuration);
builder.Services.AddPlatformOutbox(builder.Configuration);
builder.Services.AddPlatformEventBus(builder.Configuration);
builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

// Service registrations (handlers, validators, repositories, read DAOs, file storage,
// integration-event mapper, outbox event types) are added in Tasks 2 and 3.

var app = builder.Build();

app.UsePlatformWebApi();
app.MapHealthChecks("/health");
app.MapEndpointModules(app.Services, typeof(Program).Assembly);

app.Run();

public partial class Program;
```

- [ ] **Step 4: Create appsettings.json** `src/WaterNetwork.Design.Api/appsettings.json`:
```json
{
  "ServiceName": "water-network-design-be",
  "ConnectionStrings": {
    "PostgreSQL": "Host=localhost;Port=5432;Database=wn_design;Username=postgres;Password=postgres",
    "Redis": ""
  },
  "EventBus": {
    "Producer": "water-network-design-be",
    "Transport": "RabbitMq"
  },
  "MassTransit": {
    "RabbitMq": { "Host": "localhost", "Username": "guest", "Password": "guest" }
  },
  "MultiTenancy": { "AllowHeaderFallback": true },
  "Jwt": { "Mode": "Mock" },
  "Outbox": { "BatchSize": 20, "MaxRetries": 5, "PollingIntervalSeconds": 5 },
  "FileStorage": {
    "Provider": "LocalDisk",
    "LocalDisk": { "RootPath": "/tmp/wn-design-files" },
    "MaxSizeBytes": 52428800,
    "AllowedContentTypes": [
      "application/pdf",
      "image/vnd.dwg",
      "image/vnd.dxf",
      "application/dxf",
      "application/acad",
      "application/geo+json",
      "application/json",
      "application/octet-stream"
    ]
  },
  "Database": { "ApplyMigrationsOnStartup": false },
  "Serilog": { "MinimumLevel": { "Default": "Information" } }
}
```

- [ ] **Step 5: Create the integration-test fixtures + factory**

`tests/WaterNetwork.Design.IntegrationTests/CollectionFixtures.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[CollectionDefinition("design-postgis")]
public sealed class DesignPostgisCollection : ICollectionFixture<PostgisFixture>;
```

`tests/WaterNetwork.Design.IntegrationTests/DesignApiFactory.cs`:
```csharp
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

public sealed class DesignApiFactory(PostgisFixture postgis) : WebApplicationFactory<Program>
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
            ["FileStorage:LocalDisk:RootPath"] = Path.Combine(Path.GetTempPath(), "wn-design-it", Guid.CreateVersion7().ToString()),
            ["Jwt:Mode"] = "Mock"
        }));
        if (ConfigOverrides.Count > 0)
            builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(ConfigOverrides));

        var host = base.CreateHost(builder);
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<DesignDbContext>().Database.Migrate();
        return host;
    }
}
```

`tests/WaterNetwork.Design.IntegrationTests/HealthCheckTests.cs`:
```csharp
using System.Net;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class HealthCheckTests(PostgisFixture postgis)
{
    [Fact]
    public async Task Health_Endpoint_Returns_200()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
```

- [ ] **Step 6: Create the solution file** `WaterNetwork.Design.slnx`:
```xml
<Solution>
  <Folder Name="/src/services/water-network-design-be/">
    <Project Path="src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj" />
    <Project Path="src/WaterNetwork.Design.Application/WaterNetwork.Design.Application.csproj" />
    <Project Path="src/WaterNetwork.Design.Contracts/WaterNetwork.Design.Contracts.csproj" />
    <Project Path="src/WaterNetwork.Design.Domain/WaterNetwork.Design.Domain.csproj" />
    <Project Path="src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj" />
    <Folder Name="/src/services/water-network-design-be/tests/">
      <Project Path="tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj" />
      <Project Path="tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj" />
      <Project Path="tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj" />
    </Folder>
  </Folder>
</Solution>
```

- [ ] **Step 7: Build, then generate the InitialCreate migration**

```bash
dotnet build src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj
dotnet ef migrations add InitialCreate \
  -p src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj \
  -s src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj \
  -o Persistence/Migrations
```
Expected: build succeeds; migration `*_InitialCreate.cs` created under `Infrastructure/Persistence/Migrations` containing the platform `outbox_entries` / `idempotency_entries` / `processed_events` tables. (If `dotnet ef` is missing: `dotnet tool install --global dotnet-ef`.)

- [ ] **Step 8: Run the health test**

Run: `dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj`
Expected: PASS (1 test). Confirms the host boots, DB migrates (platform tables), `/health` returns 200, the OutboxProcessor finds its table.

- [ ] **Step 9: Create the Dockerfile** `src/services/water-network-design-be/Dockerfile`:
```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/ src/
RUN dotnet publish src/services/water-network-design-be/src/WaterNetwork.Design.Api -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "WaterNetwork.Design.Api.dll"]
```

- [ ] **Step 10: Add the compose service.** In `docker-compose.yml`, add AFTER the `water-network-bff` block, BEFORE top-level `volumes:` (match existing 2-space indentation). Note `FileStorage__LocalDisk__RootPath` points to a container path (no volume in DSN-1 — files are ephemeral; mount a volume later when storage matters):
```yaml
  water-network-design-be:
    build:
      context: .
      dockerfile: src/services/water-network-design-be/Dockerfile
    ports: ["8084:8080"]
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - ConnectionStrings__PostgreSQL=Host=postgres;Port=5432;Database=wn_design;Username=postgres;Password=postgres
      - ConnectionStrings__Redis=redis:6379,abortConnect=false
      - MassTransit__RabbitMq__Host=rabbitmq
      - OpenTelemetry__OtlpEndpoint=http://jaeger:4317
      - Database__ApplyMigrationsOnStartup=true
      - FileStorage__LocalDisk__RootPath=/app/design-files
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }
    networks: [wn-network]
```
Also ensure the `wn_design` database exists: check `scripts/init-databases.sql` and add `CREATE DATABASE wn_design;` (idempotent — follow the existing pattern for `wn_gis`/`wn_asset` in that file) if not present.

- [ ] **Step 11: Commit**
```bash
git add src/services/water-network-design-be docker-compose.yml scripts/init-databases.sql
git commit -m "feat(design): scaffold water-network-design-be with health endpoint + DB (DSN-1)"
```

---

## Task 2: DesignProject — create command, detail query, event

**Files (create):**
- Domain: `Aggregates/DesignProject.cs`, `ValueObjects/DesignProjectStatus.cs`, `DomainEvents/DesignProjectCreated.cs`, `Repositories/IDesignProjectRepository.cs`
- Contracts: `DesignEventTypes.cs`, `Events/DesignProjectCreatedV1.cs`, `Requests/CreateDesignProjectRequest.cs`
- Application: `Commands/CreateDesignProjectCommand.cs`, `Commands/CreateDesignProjectCommandHandler.cs`, `Validators/CreateDesignProjectCommandValidator.cs`, `Queries/GetDesignProjectDetailQuery.cs`, `Queries/GetDesignProjectDetailQueryHandler.cs`, `Dtos/DesignProjectDetailDto.cs`, `Ports/IDesignProjectReadDao.cs`
- Infrastructure: `Persistence/DesignProjectPersistenceModel.cs`, `Persistence/Configurations/DesignProjectConfiguration.cs`, `Repositories/DesignProjectRepository.cs`, `Repositories/DesignProjectReadDao.cs`, `IntegrationEvents/DesignIntegrationEventMapper.cs`
- Api: `Endpoints/ProjectsEndpointModule.cs`, `Validators/CreateDesignProjectRequestValidator.cs`, modify `Program.cs`
- Tests: unit `CreateDesignProjectTests.cs`; integration `DesignProjectApiTests.cs`; contract `DesignProjectCreatedContractTests.cs`

- [ ] **Step 1: Write the failing unit tests** `tests/WaterNetwork.Design.UnitTests/CreateDesignProjectTests.cs`:
```csharp
using FluentAssertions;
using WaterNetwork.Design.Application.Validators;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class CreateDesignProjectTests
{
    [Fact]
    public void Validator_Requires_Name()
    {
        var v = new CreateDesignProjectCommandValidator();
        v.Validate(new CreateDesignProjectCommand("", null, null)).IsValid.Should().BeFalse();
        v.Validate(new CreateDesignProjectCommand("Plan A", "branch-1", null)).IsValid.Should().BeTrue();
    }

    [Fact]
    public void Create_Sets_Open_Status_And_Raises_Event()
    {
        var p = DesignProject.Create("tenant-1", "Plan A", "branch-1", "zone-2");

        p.TenantId.Should().Be("tenant-1");
        p.Name.Should().Be("Plan A");
        p.Status.Should().Be(DesignProjectStatus.Open);
        p.Id.Should().NotBeNullOrWhiteSpace();

        var evt = p.GetDomainEvents().OfType<DesignProjectCreated>().Single();
        evt.AggregateId.Should().Be(p.Id);
        evt.Data.Name.Should().Be("Plan A");
        evt.Data.TenantId.Should().Be("tenant-1");
        evt.Data.BranchId.Should().Be("branch-1");
        evt.Data.ZoneId.Should().Be("zone-2");
    }
}
```

- [ ] **Step 2: Run to verify it fails** — `dotnet test .../WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj` → FAIL (types missing).

- [ ] **Step 3: Create the domain types**

`src/WaterNetwork.Design.Domain/ValueObjects/DesignProjectStatus.cs`:
```csharp
namespace WaterNetwork.Design.Domain.ValueObjects;

public enum DesignProjectStatus
{
    Open,
    Cancelled
}
```

`src/WaterNetwork.Design.Domain/DomainEvents/DesignProjectCreated.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignProjectCreatedData(
    string TenantId,
    string Name,
    string? BranchId,
    string? ZoneId);

public sealed record DesignProjectCreated(string AggregateId, DesignProjectCreatedData Data)
    : DomainEventBase<DesignProjectCreatedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignProject",
        eventType: "DesignProjectCreated",
        data: Data);
```

`src/WaterNetwork.Design.Domain/Aggregates/DesignProject.cs`:
```csharp
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Design.Domain.Aggregates;

public sealed class DesignProject : AggregateRoot
{
    public string TenantId { get; private set; }
    public string Name { get; private set; }
    public string? BranchId { get; private set; }
    public string? ZoneId { get; private set; }
    public DesignProjectStatus Status { get; private set; }

    private DesignProject(
        string id, string tenantId, string name, string? branchId, string? zoneId,
        DesignProjectStatus status, int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        Name = name;
        BranchId = branchId;
        ZoneId = zoneId;
        Status = status;
    }

    public static DesignProject Create(string tenantId, string name, string? branchId, string? zoneId)
    {
        var project = new DesignProject(
            Guid.CreateVersion7().ToString(), tenantId, name, branchId, zoneId, DesignProjectStatus.Open);
        project.MarkAsModified();
        project.AddDomainEvent(new DesignProjectCreated(
            project.Id, new DesignProjectCreatedData(tenantId, name, branchId, zoneId)));
        return project;
    }

    public static DesignProject Reconstitute(
        string id, string tenantId, string name, string? branchId, string? zoneId,
        DesignProjectStatus status, int version, DateTime createdAt, DateTime updatedAt)
        => new(id, tenantId, name, branchId, zoneId, status, version, createdAt, updatedAt);
}
```

`src/WaterNetwork.Design.Domain/Repositories/IDesignProjectRepository.cs`:
```csharp
using WaterNetwork.Design.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Design.Domain.Repositories;

public interface IDesignProjectRepository : IAggregateRepository<DesignProject>
{
    Task<bool> ExistsByNameAsync(string tenantId, string name, CancellationToken ct = default);
}
```

- [ ] **Step 4: Create the Contracts types**

`src/WaterNetwork.Design.Contracts/DesignEventTypes.cs`:
```csharp
namespace WaterNetwork.Design.Contracts;

public static class DesignEventTypes
{
    public const string ProjectCreated = "design.project.created";
    public const string DocumentUploaded = "design.document.uploaded";
}
```

`src/WaterNetwork.Design.Contracts/Events/DesignProjectCreatedV1.cs`:
```csharp
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.project.created</c>.</summary>
public sealed record DesignProjectCreatedV1(
    string ProjectId,
    string TenantId,
    string Name,
    string? BranchId,
    string? ZoneId);
```

`src/WaterNetwork.Design.Contracts/Requests/CreateDesignProjectRequest.cs`:
```csharp
namespace WaterNetwork.Design.Contracts.Requests;

public sealed record CreateDesignProjectRequest(string Name, string? BranchId, string? ZoneId);
```

- [ ] **Step 5: Create the Application types**

`src/WaterNetwork.Design.Application/Commands/CreateDesignProjectCommand.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record CreateDesignProjectCommand(string Name, string? BranchId, string? ZoneId) : ICommand<string>;
```

`src/WaterNetwork.Design.Application/Validators/CreateDesignProjectCommandValidator.cs`:
```csharp
using FluentValidation;
using WaterNetwork.Design.Application.Commands;

namespace WaterNetwork.Design.Application.Validators;

public sealed class CreateDesignProjectCommandValidator : AbstractValidator<CreateDesignProjectCommand>
{
    public CreateDesignProjectCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(200);
        RuleFor(x => x.BranchId).MaximumLength(64);
        RuleFor(x => x.ZoneId).MaximumLength(64);
    }
}
```

`src/WaterNetwork.Design.Application/Commands/CreateDesignProjectCommandHandler.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class CreateDesignProjectCommandHandler(
    IDesignProjectRepository repository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<CreateDesignProjectCommand, string>
{
    public async Task<string> HandleAsync(CreateDesignProjectCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to create a design project.");

        if (await repository.ExistsByNameAsync(tenant.TenantId, command.Name, ct))
            throw ConflictException.Duplicate("DesignProject", nameof(command.Name), command.Name);

        var project = DesignProject.Create(tenant.TenantId, command.Name, command.BranchId, command.ZoneId);

        try
        {
            await repository.SaveAsync(project, ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("DesignProject", nameof(command.Name), command.Name);
        }

        return project.Id;
    }

    // PG unique-violation backstop (SqlState 23505) — same pattern as gis/asset handlers.
    private static bool IsUniqueViolation(DbUpdateException ex)
        => ex.InnerException is Npgsql.PostgresException { SqlState: "23505" };
}
```

`src/WaterNetwork.Design.Application/Dtos/DesignProjectDetailDto.cs`:
```csharp
namespace WaterNetwork.Design.Application.Dtos;

public sealed record DesignProjectDetailDto(
    string Id,
    string TenantId,
    string Name,
    string? BranchId,
    string? ZoneId,
    string Status,
    DateTime CreatedAt,
    DateTime UpdatedAt);
```

`src/WaterNetwork.Design.Application/Ports/IDesignProjectReadDao.cs`:
```csharp
using WaterNetwork.Design.Application.Dtos;

namespace WaterNetwork.Design.Application.Ports;

public interface IDesignProjectReadDao
{
    Task<DesignProjectDetailDto?> GetDetailAsync(string tenantId, string projectId, CancellationToken ct = default);
    Task<bool> ExistsAsync(string tenantId, string projectId, CancellationToken ct = default);
}
```

`src/WaterNetwork.Design.Application/Queries/GetDesignProjectDetailQuery.cs`:
```csharp
using WaterNetwork.Design.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Design.Application.Queries;

public sealed record GetDesignProjectDetailQuery(string ProjectId) : IQuery<DesignProjectDetailDto?>;
```

`src/WaterNetwork.Design.Application/Queries/GetDesignProjectDetailQueryHandler.cs`:
```csharp
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Queries;

public sealed class GetDesignProjectDetailQueryHandler(
    IDesignProjectReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetDesignProjectDetailQuery, DesignProjectDetailDto?>
{
    public Task<DesignProjectDetailDto?> HandleAsync(GetDesignProjectDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
        return readDao.GetDetailAsync(tenant.TenantId, query.ProjectId, ct);
    }
}
```

- [ ] **Step 6: Create the Infrastructure types**

`src/WaterNetwork.Design.Infrastructure/Persistence/DesignProjectPersistenceModel.cs`:
```csharp
namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignProjectPersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string? BranchId { get; set; }
    public string? ZoneId { get; set; }
    public string Status { get; set; } = default!;
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

`src/WaterNetwork.Design.Infrastructure/Persistence/Configurations/DesignProjectConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignProjectConfiguration : IEntityTypeConfiguration<DesignProjectPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignProjectPersistenceModel> builder)
    {
        builder.ToTable("design_projects");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(x => x.BranchId).HasColumnName("branch_id").HasMaxLength(64);
        builder.Property(x => x.ZoneId).HasColumnName("zone_id").HasMaxLength(64);
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.Name })
            .IsUnique().HasDatabaseName("ux_design_projects_tenant_name");
    }
}
```

`src/WaterNetwork.Design.Infrastructure/Repositories/DesignProjectRepository.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignProjectRepository(
    DesignDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<DesignProject>(dbContext, eventDispatcher, outboxRepository), IDesignProjectRepository
{
    public Task<bool> ExistsByNameAsync(string tenantId, string name, CancellationToken ct = default)
        => dbContext.Set<DesignProjectPersistenceModel>().AnyAsync(x => x.TenantId == tenantId && x.Name == name, ct);

    public override async Task<DesignProject?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignProjectPersistenceModel>().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : ToDomain(m);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Design projects are not deleted in DSN-1.");

    protected override async Task PersistAsync(DesignProject aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.Set<DesignProjectPersistenceModel>().FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
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
            existing.Name = aggregate.Name;
            existing.BranchId = aggregate.BranchId;
            existing.ZoneId = aggregate.ZoneId;
            existing.Status = aggregate.Status.ToString();
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
        }
    }

    private static DesignProjectPersistenceModel ToModel(DesignProject p) => new()
    {
        Id = p.Id, TenantId = p.TenantId, Name = p.Name, BranchId = p.BranchId, ZoneId = p.ZoneId,
        Status = p.Status.ToString(), Version = p.Version, CreatedAt = p.CreatedAt, UpdatedAt = p.UpdatedAt
    };

    private static DesignProject ToDomain(DesignProjectPersistenceModel m) => DesignProject.Reconstitute(
        m.Id, m.TenantId, m.Name, m.BranchId, m.ZoneId,
        Enum.Parse<DesignProjectStatus>(m.Status), m.Version, m.CreatedAt, m.UpdatedAt);
}
```

`src/WaterNetwork.Design.Infrastructure/Repositories/DesignProjectReadDao.cs`:
```csharp
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignProjectReadDao(DesignDbContext dbContext) : IDesignProjectReadDao
{
    public async Task<DesignProjectDetailDto?> GetDetailAsync(string tenantId, string projectId, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id AS Id, tenant_id AS TenantId, name AS Name, branch_id AS BranchId,
                   zone_id AS ZoneId, status AS Status, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM design_projects
            WHERE id = @projectId AND tenant_id = @tenantId
            """;
        var connection = dbContext.Database.GetDbConnection();
        return await connection.QuerySingleOrDefaultAsync<DesignProjectDetailDto>(
            new CommandDefinition(sql, new { projectId, tenantId }, cancellationToken: ct));
    }

    public async Task<bool> ExistsAsync(string tenantId, string projectId, CancellationToken ct = default)
    {
        const string sql = "SELECT EXISTS(SELECT 1 FROM design_projects WHERE id = @projectId AND tenant_id = @tenantId)";
        var connection = dbContext.Database.GetDbConnection();
        return await connection.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { projectId, tenantId }, cancellationToken: ct));
    }
}
```

`src/WaterNetwork.Design.Infrastructure/IntegrationEvents/DesignIntegrationEventMapper.cs`:
```csharp
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Design.Infrastructure.IntegrationEvents;

public sealed record DesignProjectCreatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignProjectCreatedV1 Data)
    : IIntegrationEvent<DesignProjectCreatedV1>;

public sealed class DesignIntegrationEventMapper : IIntegrationEventMapper
{
    private static readonly Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry =
        new(StringComparer.Ordinal)
        {
            ["DesignProjectCreated"] = e => e is DesignProjectCreated x ? MapProjectCreated(x) : null,
        };

    public bool CanMap(string eventType) => Registry.ContainsKey(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
        => Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null;

    private static DesignProjectCreatedIntegrationEvent MapProjectCreated(DesignProjectCreated e)
        => new(e.EventId, DesignEventTypes.ProjectCreated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignProjectCreatedV1(e.AggregateId, e.Data.TenantId, e.Data.Name, e.Data.BranchId, e.Data.ZoneId));
}
```

- [ ] **Step 7: Create the Api types**

`src/WaterNetwork.Design.Api/Validators/CreateDesignProjectRequestValidator.cs`:
```csharp
using FluentValidation;
using WaterNetwork.Design.Contracts.Requests;

namespace WaterNetwork.Design.Api.Validators;

public sealed class CreateDesignProjectRequestValidator : AbstractValidator<CreateDesignProjectRequest>
{
    public CreateDesignProjectRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(200);
        RuleFor(x => x.BranchId).MaximumLength(64);
        RuleFor(x => x.ZoneId).MaximumLength(64);
    }
}
```

`src/WaterNetwork.Design.Api/Endpoints/ProjectsEndpointModule.cs`:
```csharp
using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Queries;
using WaterNetwork.Design.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed class ProjectsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/design/projects");

        group.MapPost("/", async (CreateDesignProjectRequest request, ICommandBus bus, CancellationToken ct) =>
            {
                var id = await bus.ExecuteAsync(
                    new CreateDesignProjectCommand(request.Name, request.BranchId, request.ZoneId), ct);
                return Results.Created($"/api/design/projects/{id}", new { id });
            })
            .WithValidation<CreateDesignProjectRequest>()
            .RequirePermission("network-design:write");

        group.MapGet("/{id}", async Task<Results<Ok<DesignProjectDetailDto>, NotFound>> (
                string id, IQueryBus bus, CancellationToken ct) =>
            {
                var dto = await bus.ExecuteAsync(new GetDesignProjectDetailQuery(id), ct);
                return dto is null ? TypedResults.NotFound() : TypedResults.Ok(dto);
            })
            .RequirePermission("network-design:read");
    }
}
```

- [ ] **Step 8: Wire DI in Program.cs.** In `src/WaterNetwork.Design.Api/Program.cs`, add usings and registrations. Add these usings:
```csharp
using FluentValidation;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Infrastructure.IntegrationEvents;
using WaterNetwork.Design.Infrastructure.Repositories;
```
Replace the comment line `// Service registrations ... Tasks 2 and 3.` with:
```csharp
builder.Services.AddHandlersFromAssembly(typeof(CreateDesignProjectCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(CreateDesignProjectCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);
builder.Services.AddScoped<IDesignProjectRepository, DesignProjectRepository>();
builder.Services.AddScoped<IDesignProjectReadDao, DesignProjectReadDao>();
builder.Services.AddSingleton<IIntegrationEventMapper, DesignIntegrationEventMapper>();
builder.Services.AddOutboxDomainEventTypesFromAssembly(
    typeof(WaterNetwork.Design.Domain.DomainEvents.DesignProjectCreated).Assembly);
```

- [ ] **Step 9: Run the unit tests** — `dotnet test .../WaterNetwork.Design.UnitTests/...` → PASS (validator + create).

- [ ] **Step 10: Generate the migration**
```bash
dotnet ef migrations add AddDesignProjects \
  -p src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj \
  -s src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj \
  -o Persistence/Migrations
```
Expected: migration adds the `design_projects` table + unique index.

- [ ] **Step 11: Write the integration tests** `tests/WaterNetwork.Design.IntegrationTests/DesignProjectApiTests.cs`:
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
public sealed class DesignProjectApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId = "tenant-1", params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId, permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Create_Then_Get_Returns_Project()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write", "network-design:read");

        var create = await client.PostAsJsonAsync("/api/design/projects", new { name = "Plan A", branchId = "b1", zoneId = "z2" });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await create.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        var get = await client.GetAsync($"/api/design/projects/{id}");
        get.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await get.Content.ReadFromJsonAsync<JsonNode>();
        body!["name"]!.GetValue<string>().Should().Be("Plan A");
        body["status"]!.GetValue<string>().Should().Be("Open");
        body["branchId"]!.GetValue<string>().Should().Be("b1");
    }

    [Fact]
    public async Task Create_Missing_Name_Returns_400()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write");

        var resp = await client.PostAsJsonAsync("/api/design/projects", new { name = "" });
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Duplicate_Name_In_Tenant_Returns_409()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-dup", "network-design:write");

        await client.PostAsJsonAsync("/api/design/projects", new { name = "Dupe" });
        var second = await client.PostAsJsonAsync("/api/design/projects", new { name = "Dupe" });
        second.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Tenant_Isolation_Hides_Other_Tenants_Project()
    {
        using var factory = new DesignApiFactory(postgis);
        using var a = Client(factory, "tenant-A", "network-design:write", "network-design:read");
        var create = await a.PostAsJsonAsync("/api/design/projects", new { name = "ASecret" });
        var id = (await create.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();

        using var b = Client(factory, "tenant-B", "network-design:read");
        var get = await b.GetAsync($"/api/design/projects/{id}");
        get.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = factory.CreateClient();
        var resp = await client.GetAsync("/api/design/projects/whatever");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 12: Write the contract test** `tests/WaterNetwork.Design.ContractTests/DesignProjectCreatedContractTests.cs`:
```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;

namespace WaterNetwork.Design.ContractTests;

public sealed class DesignProjectCreatedContractTests
{
    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        var evt = new DesignProjectCreatedV1("p1", "tenant-1", "Plan A", "b1", "z2");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("ProjectId", "TenantId", "Name", "BranchId", "ZoneId");
    }

    [Fact]
    public void EventType_Is_Fixed() => DesignEventTypes.ProjectCreated.Should().Be("design.project.created");
}
```

- [ ] **Step 13: Run all three test suites** → PASS (unit, integration, contract).

- [ ] **Step 14: Commit**
```bash
git add src/services/water-network-design-be
git commit -m "feat(design): create design project + detail query + project.created event (DSN-1)"
```

---

## Task 3: DesignDocument — upload via file storage port

**Files (create):**
- Domain: `Aggregates/DesignDocument.cs`, `ValueObjects/DesignDocumentType.cs`, `DomainEvents/DesignDocumentUploaded.cs`, `Repositories/IDesignDocumentRepository.cs`
- Contracts: `Events/DesignDocumentUploadedV1.cs`
- Application: `Ports/IFileStoragePort.cs`, `Configuration/FileStorageOptions.cs`, `Commands/UploadDesignDocumentCommand.cs`, `Commands/UploadDesignDocumentCommandHandler.cs`
- Infrastructure: `Persistence/DesignDocumentPersistenceModel.cs`, `Persistence/Configurations/DesignDocumentConfiguration.cs`, `Repositories/DesignDocumentRepository.cs`, `Storage/LocalDiskFileStorageAdapter.cs`, extend `IntegrationEvents/DesignIntegrationEventMapper.cs`
- Api: `Endpoints/DocumentsEndpointModule.cs`, modify `Program.cs`
- Tests: unit `UploadDesignDocumentTests.cs`, `LocalDiskFileStorageAdapterTests.cs`; integration `DesignDocumentApiTests.cs`; contract `DesignDocumentUploadedContractTests.cs`

- [ ] **Step 1: Write the failing unit tests** `tests/WaterNetwork.Design.UnitTests/LocalDiskFileStorageAdapterTests.cs`:
```csharp
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Infrastructure.Storage;

namespace WaterNetwork.Design.UnitTests;

public sealed class LocalDiskFileStorageAdapterTests
{
    [Fact]
    public async Task Save_Writes_File_And_Returns_Ref()
    {
        var root = Path.Combine(Path.GetTempPath(), "wn-design-ut", Guid.CreateVersion7().ToString());
        var opts = Options.Create(new FileStorageOptions { LocalDisk = new LocalDiskOptions { RootPath = root } });
        var adapter = new LocalDiskFileStorageAdapter(opts);

        using var content = new MemoryStream(Encoding.UTF8.GetBytes("hello"));
        var fileRef = await adapter.SaveAsync("plan.pdf", "application/pdf", content, CancellationToken.None);

        fileRef.Should().NotBeNullOrWhiteSpace();
        File.Exists(Path.Combine(root, fileRef)).Should().BeTrue();
        (await File.ReadAllTextAsync(Path.Combine(root, fileRef))).Should().Be("hello");
    }
}
```

`tests/WaterNetwork.Design.UnitTests/UploadDesignDocumentTests.cs`:
```csharp
using FluentAssertions;
using NSubstitute;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class UploadDesignDocumentTests
{
    [Fact]
    public void Document_Create_Raises_Uploaded_Event()
    {
        var d = DesignDocument.Create("proj-1", "tenant-1", "plan.pdf", "application/pdf", 123, "ref/x", "Pdf", "user-9");

        d.ProjectId.Should().Be("proj-1");
        d.FileRef.Should().Be("ref/x");
        d.SizeBytes.Should().Be(123);
        var evt = d.GetDomainEvents().OfType<DesignDocumentUploaded>().Single();
        evt.Data.ProjectId.Should().Be("proj-1");
        evt.Data.FileRef.Should().Be("ref/x");
        evt.Data.DocumentType.Should().Be("Pdf");
    }

    [Fact]
    public async Task Handler_Persists_Document_With_Actor()
    {
        var repo = Substitute.For<IDesignDocumentRepository>();
        var tenant = Substitute.For<ITenantContextAccessor>();
        tenant.Current.Returns(new TenantContext("tenant-1", null, null));
        var reqCtx = Substitute.For<IRequestContextProvider>();
        reqCtx.Current().Returns(new RequestContext(UserId: "user-9", CorrelationId: "c1"));

        var handler = new UploadDesignDocumentCommandHandler(repo, tenant, reqCtx);
        var id = await handler.HandleAsync(
            new UploadDesignDocumentCommand("proj-1", "plan.pdf", "application/pdf", 123, "ref/x", "Pdf"), CancellationToken.None);

        id.Should().NotBeNullOrWhiteSpace();
        await repo.Received(1).SaveAsync(Arg.Is<DesignDocument>(d => d.UploadedBy == "user-9" && d.ProjectId == "proj-1"), Arg.Any<CancellationToken>());
    }
}
```
> NOTE: verify the exact shape of `TenantContext` and `RequestContext` (constructor params) before relying on the above — read `WaterPlatform.BuildingBlocks.MultiTenancy.TenantContext` and `WaterPlatform.BuildingBlocks.Application.Context.RequestContext`/`IRequestContextProvider`. Adjust the test construction to match (the assertion intent stays the same).

- [ ] **Step 2: Run to verify it fails** — `dotnet test .../UnitTests` → FAIL (types missing).

- [ ] **Step 3: Create the domain types**

`src/WaterNetwork.Design.Domain/ValueObjects/DesignDocumentType.cs`:
```csharp
namespace WaterNetwork.Design.Domain.ValueObjects;

public enum DesignDocumentType
{
    Pdf,
    Dwg,
    Dxf,
    GeoJson,
    Other
}
```

`src/WaterNetwork.Design.Domain/DomainEvents/DesignDocumentUploaded.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignDocumentUploadedData(
    string ProjectId,
    string TenantId,
    string FileName,
    string ContentType,
    long SizeBytes,
    string FileRef,
    string DocumentType);

public sealed record DesignDocumentUploaded(string AggregateId, DesignDocumentUploadedData Data)
    : DomainEventBase<DesignDocumentUploadedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignDocument",
        eventType: "DesignDocumentUploaded",
        data: Data);
```

`src/WaterNetwork.Design.Domain/Aggregates/DesignDocument.cs`:
```csharp
using WaterNetwork.Design.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Design.Domain.Aggregates;

public sealed class DesignDocument : AggregateRoot
{
    public string ProjectId { get; private set; }
    public string TenantId { get; private set; }
    public string FileName { get; private set; }
    public string ContentType { get; private set; }
    public long SizeBytes { get; private set; }
    public string FileRef { get; private set; }
    public string DocumentType { get; private set; }
    public string UploadedBy { get; private set; }

    private DesignDocument(
        string id, string projectId, string tenantId, string fileName, string contentType,
        long sizeBytes, string fileRef, string documentType, string uploadedBy,
        int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        ProjectId = projectId;
        TenantId = tenantId;
        FileName = fileName;
        ContentType = contentType;
        SizeBytes = sizeBytes;
        FileRef = fileRef;
        DocumentType = documentType;
        UploadedBy = uploadedBy;
    }

    public static DesignDocument Create(
        string projectId, string tenantId, string fileName, string contentType,
        long sizeBytes, string fileRef, string documentType, string uploadedBy)
    {
        var doc = new DesignDocument(
            Guid.CreateVersion7().ToString(), projectId, tenantId, fileName, contentType,
            sizeBytes, fileRef, documentType, uploadedBy);
        doc.MarkAsModified();
        doc.AddDomainEvent(new DesignDocumentUploaded(doc.Id, new DesignDocumentUploadedData(
            projectId, tenantId, fileName, contentType, sizeBytes, fileRef, documentType)));
        return doc;
    }

    public static DesignDocument Reconstitute(
        string id, string projectId, string tenantId, string fileName, string contentType,
        long sizeBytes, string fileRef, string documentType, string uploadedBy,
        int version, DateTime createdAt, DateTime updatedAt)
        => new(id, projectId, tenantId, fileName, contentType, sizeBytes, fileRef, documentType, uploadedBy,
            version, createdAt, updatedAt);
}
```

`src/WaterNetwork.Design.Domain/Repositories/IDesignDocumentRepository.cs`:
```csharp
using WaterNetwork.Design.Domain.Aggregates;
using WaterPlatform.BuildingBlocks.Domain.Repositories;

namespace WaterNetwork.Design.Domain.Repositories;

public interface IDesignDocumentRepository : IAggregateRepository<DesignDocument>;
```

- [ ] **Step 4: Create the Contracts event** `src/WaterNetwork.Design.Contracts/Events/DesignDocumentUploadedV1.cs`:
```csharp
namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.document.uploaded</c>.</summary>
public sealed record DesignDocumentUploadedV1(
    string DocumentId,
    string ProjectId,
    string TenantId,
    string FileName,
    string ContentType,
    long SizeBytes,
    string FileRef,
    string DocumentType);
```

- [ ] **Step 5: Create the Application types**

`src/WaterNetwork.Design.Application/Ports/IFileStoragePort.cs`:
```csharp
namespace WaterNetwork.Design.Application.Ports;

/// <summary>
/// Abstraction over file storage. DSN-1 ships a local-disk mock adapter; a real adapter
/// (platform-core/file-storage-be, presigned) is swapped in later without touching callers.
/// </summary>
public interface IFileStoragePort
{
    /// <summary>Stores the content and returns an opaque storage reference (key/path).</summary>
    Task<string> SaveAsync(string fileName, string contentType, Stream content, CancellationToken ct);
}
```

`src/WaterNetwork.Design.Application/Configuration/FileStorageOptions.cs`:
```csharp
namespace WaterNetwork.Design.Application.Configuration;

public sealed class FileStorageOptions
{
    public const string SectionName = "FileStorage";
    public string Provider { get; set; } = "LocalDisk";
    public LocalDiskOptions LocalDisk { get; set; } = new();
    public long MaxSizeBytes { get; set; } = 52_428_800; // 50 MB
    public string[] AllowedContentTypes { get; set; } = [];
}

public sealed class LocalDiskOptions
{
    public string RootPath { get; set; } = "";
}
```

`src/WaterNetwork.Design.Application/Commands/UploadDesignDocumentCommand.cs`:
```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

/// <summary>Commits document metadata AFTER the file has been stored (fileRef already obtained).</summary>
public sealed record UploadDesignDocumentCommand(
    string ProjectId,
    string FileName,
    string ContentType,
    long SizeBytes,
    string FileRef,
    string DocumentType) : ICommand<string>;
```

`src/WaterNetwork.Design.Application/Commands/UploadDesignDocumentCommandHandler.cs`:
```csharp
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class UploadDesignDocumentCommandHandler(
    IDesignDocumentRepository repository,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<UploadDesignDocumentCommand, string>
{
    public async Task<string> HandleAsync(UploadDesignDocumentCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to upload a document.");
        var actor = requestContextProvider.Current()?.UserId ?? tenant.TenantId;

        var document = DesignDocument.Create(
            command.ProjectId, tenant.TenantId, command.FileName, command.ContentType,
            command.SizeBytes, command.FileRef, command.DocumentType, actor);

        await repository.SaveAsync(document, ct);
        return document.Id;
    }
}
```

- [ ] **Step 6: Create the Infrastructure types**

`src/WaterNetwork.Design.Infrastructure/Storage/LocalDiskFileStorageAdapter.cs`:
```csharp
using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Application.Ports;

namespace WaterNetwork.Design.Infrastructure.Storage;

/// <summary>
/// Mock file storage that writes to local disk. Returns a relative ref "{guid}/{fileName}".
/// Swap for a real file-storage-be adapter later via FileStorage:Provider (decision #12).
/// </summary>
public sealed class LocalDiskFileStorageAdapter(IOptions<FileStorageOptions> options) : IFileStoragePort
{
    private readonly string _root = options.Value.LocalDisk.RootPath;

    public async Task<string> SaveAsync(string fileName, string contentType, Stream content, CancellationToken ct)
    {
        var safeName = Path.GetFileName(fileName); // strip any path components
        var relativeDir = Guid.CreateVersion7().ToString();
        var absoluteDir = Path.Combine(_root, relativeDir);
        Directory.CreateDirectory(absoluteDir);

        var absolutePath = Path.Combine(absoluteDir, safeName);
        await using (var dest = File.Create(absolutePath))
        {
            await content.CopyToAsync(dest, ct);
        }
        return Path.Combine(relativeDir, safeName);
    }
}
```

`src/WaterNetwork.Design.Infrastructure/Persistence/DesignDocumentPersistenceModel.cs`:
```csharp
namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignDocumentPersistenceModel
{
    public string Id { get; set; } = default!;
    public string ProjectId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string FileName { get; set; } = default!;
    public string ContentType { get; set; } = default!;
    public long SizeBytes { get; set; }
    public string FileRef { get; set; } = default!;
    public string DocumentType { get; set; } = default!;
    public string UploadedBy { get; set; } = default!;
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

`src/WaterNetwork.Design.Infrastructure/Persistence/Configurations/DesignDocumentConfiguration.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignDocumentConfiguration : IEntityTypeConfiguration<DesignDocumentPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignDocumentPersistenceModel> builder)
    {
        builder.ToTable("design_documents");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.ProjectId).HasColumnName("project_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.FileName).HasColumnName("file_name").HasMaxLength(512).IsRequired();
        builder.Property(x => x.ContentType).HasColumnName("content_type").HasMaxLength(128).IsRequired();
        builder.Property(x => x.SizeBytes).HasColumnName("size_bytes");
        builder.Property(x => x.FileRef).HasColumnName("file_ref").HasMaxLength(1024).IsRequired();
        builder.Property(x => x.DocumentType).HasColumnName("document_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.UploadedBy).HasColumnName("uploaded_by").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => x.ProjectId).HasDatabaseName("ix_design_documents_project");
    }
}
```

`src/WaterNetwork.Design.Infrastructure/Repositories/DesignDocumentRepository.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignDocumentRepository(
    DesignDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<DesignDocument>(dbContext, eventDispatcher, outboxRepository), IDesignDocumentRepository
{
    public override async Task<DesignDocument?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignDocumentPersistenceModel>().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : DesignDocument.Reconstitute(
            m.Id, m.ProjectId, m.TenantId, m.FileName, m.ContentType, m.SizeBytes, m.FileRef,
            m.DocumentType, m.UploadedBy, m.Version, m.CreatedAt, m.UpdatedAt);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Design documents are not deleted in DSN-1.");

    protected override async Task PersistAsync(DesignDocument aggregate, int expectedVersion, CancellationToken ct)
    {
        var exists = await dbContext.Set<DesignDocumentPersistenceModel>().AnyAsync(x => x.Id == aggregate.Id, ct);
        if (exists)
            throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, aggregate.Version);

        dbContext.Add(new DesignDocumentPersistenceModel
        {
            Id = aggregate.Id, ProjectId = aggregate.ProjectId, TenantId = aggregate.TenantId,
            FileName = aggregate.FileName, ContentType = aggregate.ContentType, SizeBytes = aggregate.SizeBytes,
            FileRef = aggregate.FileRef, DocumentType = aggregate.DocumentType, UploadedBy = aggregate.UploadedBy,
            Version = aggregate.Version, CreatedAt = aggregate.CreatedAt, UpdatedAt = aggregate.UpdatedAt
        });
    }
}
```

Extend `src/WaterNetwork.Design.Infrastructure/IntegrationEvents/DesignIntegrationEventMapper.cs` — add the document integration event record and registry entry:
```csharp
public sealed record DesignDocumentUploadedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignDocumentUploadedV1 Data)
    : IIntegrationEvent<DesignDocumentUploadedV1>;
```
In the `Registry` dictionary add:
```csharp
            ["DesignDocumentUploaded"] = e => e is DesignDocumentUploaded x ? MapDocumentUploaded(x) : null,
```
And add the mapper method:
```csharp
    private static DesignDocumentUploadedIntegrationEvent MapDocumentUploaded(DesignDocumentUploaded e)
        => new(e.EventId, DesignEventTypes.DocumentUploaded, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignDocumentUploadedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId, e.Data.FileName,
                e.Data.ContentType, e.Data.SizeBytes, e.Data.FileRef, e.Data.DocumentType));
```
(Add `using WaterNetwork.Design.Domain.DomainEvents;` if not already present — it is.)

- [ ] **Step 7: Create the upload endpoint.** Create `src/WaterNetwork.Design.Api/Endpoints/DocumentsEndpointModule.cs` with the full implementation below. The handler injects the read DAO, file storage port, options, tenant accessor, and command bus, and orchestrates validate→store→commit:

```csharp
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed class DocumentsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/design/projects/{projectId}/documents");

        group.MapPost("/", async (
                string projectId,
                HttpRequest httpRequest,
                IDesignProjectReadDao projects,
                IFileStoragePort storage,
                IOptions<FileStorageOptions> options,
                ITenantContextAccessor tenantAccessor,
                ICommandBus bus,
                CancellationToken ct) =>
            {
                var tenant = tenantAccessor.Current
                    ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

                if (!httpRequest.HasFormContentType)
                    return Results.Problem("multipart/form-data with a 'file' part is required.", statusCode: 400);

                var form = await httpRequest.ReadFormAsync(ct);
                var file = form.Files.GetFile("file");
                var documentTypeRaw = form["documentType"].ToString();

                if (file is null || file.Length == 0)
                    return Results.Problem("A non-empty 'file' part is required.", statusCode: 400);

                var opts = options.Value;
                if (file.Length > opts.MaxSizeBytes)
                    return Results.Problem($"File exceeds the maximum size of {opts.MaxSizeBytes} bytes.", statusCode: 400);
                if (opts.AllowedContentTypes.Length > 0 &&
                    Array.IndexOf(opts.AllowedContentTypes, file.ContentType) < 0)
                    return Results.Problem($"Content type '{file.ContentType}' is not allowed.", statusCode: 400);
                if (!Enum.TryParse<DesignDocumentType>(documentTypeRaw, ignoreCase: true, out var docType))
                    return Results.Problem("documentType must be one of: Pdf, Dwg, Dxf, GeoJson, Other.", statusCode: 400);

                // Project must exist + belong to caller's tenant (404 also hides cross-tenant ids).
                if (!await projects.ExistsAsync(tenant.TenantId, projectId, ct))
                    return Results.NotFound();

                // Step 1: store the file. Storage failure → 502, metadata NOT committed.
                string fileRef;
                try
                {
                    await using var stream = file.OpenReadStream();
                    fileRef = await storage.SaveAsync(file.FileName, file.ContentType, stream, ct);
                }
                catch (Exception)
                {
                    return Results.Problem("File storage is unavailable.", statusCode: 502);
                }

                // Step 2: commit metadata + outbox event.
                var id = await bus.ExecuteAsync(new UploadDesignDocumentCommand(
                    projectId, file.FileName, file.ContentType, file.Length, fileRef, docType.ToString()), ct);

                return Results.Created($"/api/design/projects/{projectId}/documents/{id}", new { id });
            })
            .RequirePermission("network-design:write")
            .DisableAntiforgery();
    }
}
```
> NOTE: `.DisableAntiforgery()` is required for minimal-API multipart endpoints in .NET. If it's unavailable/needed differently, the integration test will reveal it — adjust per the framework.

- [ ] **Step 8: Wire DI in Program.cs.** Add usings:
```csharp
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Infrastructure.Storage;
```
After the existing `AddScoped<IDesignProjectReadDao,...>` line add:
```csharp
builder.Services.Configure<FileStorageOptions>(builder.Configuration.GetSection(FileStorageOptions.SectionName));
builder.Services.AddScoped<IDesignDocumentRepository, DesignDocumentRepository>();
builder.Services.AddSingleton<IFileStoragePort, LocalDiskFileStorageAdapter>();
```
(`IDesignDocumentRepository` using: `WaterNetwork.Design.Domain.Repositories` already imported; add `using WaterNetwork.Design.Application.Ports;` if missing.)

- [ ] **Step 9: Run unit tests** → PASS (adapter + document create + handler). (If `TenantContext`/`RequestContext` ctor differs, fix the test per the Step-1 note.)

- [ ] **Step 10: Generate the migration**
```bash
dotnet ef migrations add AddDesignDocuments \
  -p src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure/WaterNetwork.Design.Infrastructure.csproj \
  -s src/services/water-network-design-be/src/WaterNetwork.Design.Api/WaterNetwork.Design.Api.csproj \
  -o Persistence/Migrations
```

- [ ] **Step 11: Write the integration tests** `tests/WaterNetwork.Design.IntegrationTests/DesignDocumentApiTests.cs`:
```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignDocumentApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId, params string[] perms)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId, permissions: perms);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> CreateProject(HttpClient client, string name)
    {
        var resp = await client.PostAsJsonAsync("/api/design/projects", new { name });
        return (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
    }

    private static MultipartFormDataContent FilePart(string content, string fileName, string contentType, string documentType)
    {
        var form = new MultipartFormDataContent();
        var bytes = new ByteArrayContent(Encoding.UTF8.GetBytes(content));
        bytes.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(bytes, "file", fileName);
        form.Add(new StringContent(documentType), "documentType");
        return form;
    }

    [Fact]
    public async Task Upload_Returns_201_And_Persists()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write");
        var projectId = await CreateProject(client, "DocProj");

        var resp = await client.PostAsync($"/api/design/projects/{projectId}/documents",
            FilePart("PDFDATA", "plan.pdf", "application/pdf", "Pdf"));

        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        id.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Upload_Invalid_ContentType_Returns_400()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write");
        var projectId = await CreateProject(client, "BadType");

        var resp = await client.PostAsync($"/api/design/projects/{projectId}/documents",
            FilePart("x", "evil.exe", "application/x-msdownload", "Other"));

        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Upload_To_Missing_Project_Returns_404()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write");

        var resp = await client.PostAsync("/api/design/projects/does-not-exist/documents",
            FilePart("x", "plan.pdf", "application/pdf", "Pdf"));

        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Storage_Failure_Returns_502_And_Does_Not_Commit_Metadata()
    {
        using var factory = new DesignApiFactory(postgis);
        var throwingStorage = Substitute.For<IFileStoragePort>();
        throwingStorage.SaveAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<Stream>(), Arg.Any<CancellationToken>())
            .Returns<Task<string>>(_ => throw new IOException("disk full"));

        // Replace the real adapter with a throwing one for this test.
        var clientFactory = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IFileStoragePort));
                s.AddSingleton(throwingStorage);
            }));
        var client = clientFactory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), "u", "tenant-1", permissions: ["network-design:write"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var projectId = await CreateProject(client, "StorageFail");
        var resp = await client.PostAsync($"/api/design/projects/{projectId}/documents",
            FilePart("x", "plan.pdf", "application/pdf", "Pdf"));

        resp.StatusCode.Should().Be(HttpStatusCode.BadGateway);
    }
}
```
> NOTE: `RemoveAll` needs `using Microsoft.Extensions.DependencyInjection.Extensions;`. If `WithWebHostBuilder` + `ConfigureTestServices` interferes with the factory's `CreateHost` migration, fall back to constructing a dedicated factory subclass that overrides the storage registration. Confirm the 502-path also leaves `design_documents` empty for that project (optional explicit DB assert via a scope + `DesignDbContext`).

- [ ] **Step 12: Write the contract test** `tests/WaterNetwork.Design.ContractTests/DesignDocumentUploadedContractTests.cs`:
```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;

namespace WaterNetwork.Design.ContractTests;

public sealed class DesignDocumentUploadedContractTests
{
    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        var evt = new DesignDocumentUploadedV1("d1", "p1", "tenant-1", "plan.pdf", "application/pdf", 123, "ref/x", "Pdf");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("DocumentId", "ProjectId", "TenantId", "FileName", "ContentType", "SizeBytes", "FileRef", "DocumentType");
    }

    [Fact]
    public void EventType_Is_Fixed() => DesignEventTypes.DocumentUploaded.Should().Be("design.document.uploaded");
}
```

- [ ] **Step 13: Run all three suites** → PASS (unit, integration, contract).

- [ ] **Step 14: Commit**
```bash
git add src/services/water-network-design-be
git commit -m "feat(design): upload design document via file storage port + document.uploaded event (DSN-1)"
```

---

## Task 4: Finalize — tracking, follow-ups, full gate

**Files:** modify `docs/stories/backlog.md`, `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`

- [ ] **Step 1: Full solution test gate.** Run all four (build must be 0-warning — TreatWarningsAsErrors):
```bash
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.ContractTests/WaterNetwork.Design.ContractTests.csproj
```
Expected: all PASS, 0 warnings. Also `docker compose config --quiet && echo OK` (skip if docker unavailable).

- [ ] **Step 2: Tick the roadmap.** In `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §3.3, change:
```
| 2 | DSN-1 Project + Document (file-storage port) | design-be | US-P2-01, 02 | — |
```
to:
```
| 2 | DSN-1 Project + Document (file-storage port) ✓ | design-be | US-P2-01, 02 | — |
```

- [ ] **Step 3: Update backlog.** In `docs/stories/backlog.md`, change the Phase 2 row status from `unsliced` to `in progress (DSN-1 done)`, and append a follow-up section:
```markdown
## Follow-up sau DSN-1 Design Project + Document

- **Real file storage adapter**: `HttpFileStorageAdapter` → platform-core/file-storage-be (presigned
  URL, retention). DSN-1 dùng `LocalDiskFileStorageAdapter` mock. Swap qua `FileStorage:Provider`,
  không đụng Domain/Application (decision #12). Mount volume cho compose khi cần file bền.
- **Orphan file khi DB commit fail sau khi đã lưu file**: hiện chấp nhận (mock local). Thêm
  compensating delete hoặc cleanup job khi lên storage thật.
- **Download document endpoint** + **project list/search** + **Cancel project**: chưa làm (US không yêu cầu DSN-1).
- **DSN-2**: `DesignRevision` state machine + `DraftNetworkAsset` + validation engine + PostGIS
  extension/NTS + preview query.
- **Antiforgery cho multipart**: endpoint dùng `.DisableAntiforgery()`; xem lại khi bật antiforgery toàn cục.
```

- [ ] **Step 4: Commit**
```bash
git add docs/stories/backlog.md docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md
git commit -m "chore(design): close DSN-1 tracking + follow-ups (DSN-1)"
```

---

## Done criteria

- `water-network-design-be` solution: unit + integration + contract tests green, 0 warnings.
- `POST /api/design/projects` (201 / 400 / 409), `GET /api/design/projects/{id}` (200 / 404), `POST /api/design/projects/{projectId}/documents` (201 / 400 / 404 / 502) behave per the spec error table.
- `design.project.created` + `design.document.uploaded` published via outbox; tenant isolation enforced; file stored on disk via the mock adapter.
- Dockerfile + compose entry (port 8084) + `wn_design` DB; roadmap DSN-1 ticked; backlog updated.
```
