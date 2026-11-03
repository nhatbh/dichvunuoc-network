# Phase 0 Foundation + US-P1-01 RegisterNode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng monorepo Water Network Backend Platform với building blocks extract từ skeleton sample (custom dispatcher thay MediatR, MultiTenancy, mock JWT, Minimal API bootstrap, Testing fixtures) và slice US-P1-01 RegisterNode chạy end-to-end trên `water-network-gis-be` (PostGIS + Outbox + tests).

**Architecture:** Monorepo; building blocks là project references tại `src/building-blocks/`; mỗi service là solution riêng tại `src/services/<service>/`, database riêng, giao tiếp qua MassTransit/RabbitMQ với envelope chuẩn. Nguồn copy: `docs/sample/dotnet-skeleton-sample` (gọi tắt **SAMPLE** trong plan này).

**Tech Stack:** .NET 10 (SDK 10.0.107), EF Core 10 + Npgsql + NetTopologySuite, PostgreSQL/PostGIS, Dapper (read-side), MassTransit 8 + RabbitMQ, FluentValidation, Serilog + OpenTelemetry, xUnit + FluentAssertions + NSubstitute + Testcontainers.

**Spec tham chiếu:** `docs/superpowers/specs/2026-06-11-water-network-platform-design.md` và `docs/spec-init-01.md` (US-P0-01..04, US-P1-01, §19).

---

## Quy ước chung cho mọi task

- Thư mục gốc repo: `/Users/dannv/Workspace/TECHGEN/water-platform/water-network/water-network-be` — mọi đường dẫn tương đối tính từ đây.
- `SAMPLE` = `docs/sample/dotnet-skeleton-sample`.
- macOS: dùng `sed -i ''` (có chuỗi rỗng sau `-i`).
- KHÔNG copy các file sample-specific: mọi file chứa `Order*`, `Product*`, `Reporting*`, `Sample*`, `ReadModel*`, `MapPoint*`, thư mục `Migrations/` của SAMPLE.
- Sau mỗi batch copy, chạy **bảng sed namespace chuẩn** (xem Task 2 Step 3) trên toàn bộ `src/building-blocks/`.
- Commit message theo conventional commits, kết thúc bằng `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Mọi lệnh `dotnet` chạy từ thư mục chứa file `.sln` tương ứng (hoặc truyền đường dẫn project).

## Bản đồ file tổng thể

```text
water-network-be/
├── global.json, Directory.Build.props, Directory.Packages.props, .editorconfig
├── docker-compose.yml
├── WaterPlatform.BuildingBlocks.slnx
├── src/
│   ├── building-blocks/
│   │   ├── WaterPlatform.BuildingBlocks.Domain/            (Task 2)
│   │   ├── WaterPlatform.BuildingBlocks.Application/       (Task 3 — custom dispatcher)
│   │   ├── WaterPlatform.BuildingBlocks.Infrastructure/    (Task 4 — PlatformDbContext, Outbox/Inbox)
│   │   ├── WaterPlatform.BuildingBlocks.MultiTenancy/      (Task 5)
│   │   ├── WaterPlatform.BuildingBlocks.EventBus/          (Task 6 — envelope spec §16)
│   │   ├── WaterPlatform.BuildingBlocks.Security/          (Task 7 — mock JWT)
│   │   ├── WaterPlatform.BuildingBlocks.Observability/     (Task 8)
│   │   ├── WaterPlatform.BuildingBlocks.WebApi/            (Task 8 — Minimal API bootstrap)
│   │   ├── WaterPlatform.BuildingBlocks.Testing/           (Task 9 — Testcontainers fixtures)
│   │   └── tests/
│   │       ├── WaterPlatform.BuildingBlocks.Domain.Tests/
│   │       ├── WaterPlatform.BuildingBlocks.Application.Tests/
│   │       └── WaterPlatform.BuildingBlocks.MultiTenancy.Tests/
│   └── services/
│       └── water-network-gis-be/
│           ├── WaterNetwork.Gis.slnx
│           ├── src/                                        (production projects)
│           │   ├── WaterNetwork.Gis.Api/                       (Task 10, 15)
│           │   ├── WaterNetwork.Gis.Application/               (Task 12)
│           │   ├── WaterNetwork.Gis.Domain/                    (Task 11)
│           │   ├── WaterNetwork.Gis.Infrastructure/            (Task 13)
│           │   └── WaterNetwork.Gis.Contracts/                 (Task 14, 15)
│           └── tests/
│               ├── WaterNetwork.Gis.UnitTests/
│               ├── WaterNetwork.Gis.IntegrationTests/
│               └── WaterNetwork.Gis.ContractTests/
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `global.json`, `Directory.Build.props`, `Directory.Packages.props`, `.editorconfig`, `docker-compose.yml`

- [ ] **Step 1: Copy các file cấu hình gốc từ SAMPLE**

```bash
cp docs/sample/dotnet-skeleton-sample/global.json global.json
cp docs/sample/dotnet-skeleton-sample/Directory.Build.props Directory.Build.props
cp docs/sample/dotnet-skeleton-sample/.editorconfig .editorconfig
```

- [ ] **Step 2: Tạo `Directory.Packages.props`** (bỏ MediatR/Mapster, thêm NTS + Testcontainers.RabbitMq)

Nội dung đầy đủ (thay thế hoàn toàn, không copy từ SAMPLE):

```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.AspNetCore.OpenApi" Version="10.0.8" />
    <PackageVersion Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="10.0.8" />
    <PackageVersion Include="Scalar.AspNetCore" Version="2.14.14" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore" Version="10.0.8" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.8" />
    <PackageVersion Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.2" />
    <PackageVersion Include="Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite" Version="10.0.2" />
    <PackageVersion Include="NetTopologySuite" Version="2.6.0" />
    <PackageVersion Include="Dapper" Version="2.1.66" />
    <PackageVersion Include="MassTransit" Version="8.5.0" />
    <PackageVersion Include="MassTransit.RabbitMQ" Version="8.5.0" />
    <PackageVersion Include="FluentValidation" Version="11.11.0" />
    <PackageVersion Include="FluentValidation.DependencyInjectionExtensions" Version="11.11.0" />
    <PackageVersion Include="StackExchange.Redis" Version="2.8.24" />
    <PackageVersion Include="Microsoft.Extensions.Caching.StackExchangeRedis" Version="10.0.8" />
    <PackageVersion Include="Serilog" Version="4.3.0" />
    <PackageVersion Include="Serilog.AspNetCore" Version="9.0.0" />
    <PackageVersion Include="Serilog.Sinks.Console" Version="6.0.0" />
    <PackageVersion Include="Serilog.Sinks.Grafana.Loki" Version="8.3.0" />
    <PackageVersion Include="OpenTelemetry" Version="1.15.3" />
    <PackageVersion Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.15.3" />
    <PackageVersion Include="OpenTelemetry.Exporter.Prometheus.AspNetCore" Version="1.12.0-beta.1" />
    <PackageVersion Include="OpenTelemetry.Extensions.Hosting" Version="1.15.3" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.15.2" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.EntityFrameworkCore" Version="1.12.0-beta.2" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.Http" Version="1.15.1" />
    <PackageVersion Include="AspNetCore.HealthChecks.NpgSql" Version="9.0.0" />
    <PackageVersion Include="AspNetCore.HealthChecks.Redis" Version="9.0.0" />
    <PackageVersion Include="AspNetCore.HealthChecks.Rabbitmq" Version="9.0.0" />
    <PackageVersion Include="Microsoft.Extensions.Http" Version="10.0.8" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.14.0" />
    <PackageVersion Include="xunit" Version="2.9.3" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="3.0.2" />
    <PackageVersion Include="FluentAssertions" Version="8.4.0" />
    <PackageVersion Include="NSubstitute" Version="5.3.0" />
    <PackageVersion Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.8" />
    <PackageVersion Include="Testcontainers.PostgreSql" Version="4.4.0" />
    <PackageVersion Include="Testcontainers.RabbitMq" Version="4.4.0" />
    <PackageVersion Include="Testcontainers.Redis" Version="4.4.0" />
  </ItemGroup>
</Project>
```

- [ ] **Step 3: Tạo `docker-compose.yml`** (hạ tầng; service gis-be thêm ở Task 16)

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./scripts/init-databases.sql:/docker-entrypoint-initdb.d/init-databases.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks: [wn-network]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks: [wn-network]

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports: ["5672:5672", "15672:15672"]
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [wn-network]

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports: ["4317:4317", "16686:16686"]
    environment:
      COLLECTOR_OTLP_ENABLED: true
    networks: [wn-network]

volumes:
  postgres-data:

networks:
  wn-network:
    driver: bridge
```

- [ ] **Step 4: Tạo `scripts/init-databases.sql`** (database-per-service)

```sql
CREATE DATABASE wn_gis;
CREATE DATABASE wn_asset;
\c wn_gis
CREATE EXTENSION IF NOT EXISTS postgis;
```

- [ ] **Step 5: Verify compose hợp lệ**

Run: `docker compose config --quiet && echo OK`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add global.json Directory.Build.props Directory.Packages.props .editorconfig docker-compose.yml scripts/init-databases.sql
git commit -m "chore: scaffold monorepo build props and local infra compose"
```

---

### Task 2: WaterPlatform.BuildingBlocks.Domain

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.Domain/WaterPlatform.BuildingBlocks.Domain.csproj`
- Copy from SAMPLE: `src/libs/WaterNetworkGisBe.Core/Domain/**` → `src/building-blocks/src/WaterPlatform.BuildingBlocks.Domain/` ; `src/libs/WaterNetworkGisBe.Core/Common/Exceptions/**` → `.../Exceptions/`
- Test: `src/building-blocks/tests/WaterPlatform.BuildingBlocks.Domain.Tests/`

- [ ] **Step 1: Tạo csproj + solution building blocks**

`src/building-blocks/src/WaterPlatform.BuildingBlocks.Domain/WaterPlatform.BuildingBlocks.Domain.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <RootNamespace>WaterPlatform.BuildingBlocks.Domain</RootNamespace>
  </PropertyGroup>
</Project>
```

```bash
dotnet new sln -n WaterPlatform.BuildingBlocks
dotnet sln WaterPlatform.BuildingBlocks.slnx add building-blocks/WaterPlatform.BuildingBlocks.Domain
```

- [ ] **Step 2: Copy source từ SAMPLE**

```bash
SAMPLE=docs/sample/dotnet-skeleton-sample
DEST=building-blocks/WaterPlatform.BuildingBlocks.Domain
cp -R $SAMPLE/src/libs/WaterNetworkGisBe.Core/Domain/* $DEST/
mkdir -p $DEST/Exceptions
cp $SAMPLE/src/libs/WaterNetworkGisBe.Core/Common/Exceptions/*.cs $DEST/Exceptions/
```

Lưu ý: `Domain/Exceptions/DomainException.cs` (của Core/Domain) và `Common/Exceptions/DomainException.cs` trùng tên class — giữ bản trong `Exceptions/` (từ Common), xóa file `$DEST/Exceptions/DomainException.cs` copy từ Domain nếu xung đột namespace sau sed (cả hai sẽ về cùng namespace). Chạy: `rm $DEST/Exceptions/DomainException.cs` nếu build báo duplicate, giữ bản từ `Common/Exceptions`.

- [ ] **Step 3: Chạy bảng sed namespace chuẩn** (dùng lại cho MỌI task copy sau)

```bash
find building-blocks -name '*.cs' -exec sed -i '' \
 -e 's/WaterNetworkGisBe\.Core\.Domain/WaterPlatform.BuildingBlocks.Domain/g' \
 -e 's/WaterNetworkGisBe\.Core\.Common\.Exceptions/WaterPlatform.BuildingBlocks.Domain.Exceptions/g' \
 -e 's/WaterNetworkGisBe\.Core\.Common\.Context/WaterPlatform.BuildingBlocks.Application.Context/g' \
 -e 's/WaterNetworkGisBe\.Core\.Application/WaterPlatform.BuildingBlocks.Application/g' \
 -e 's/WaterNetworkGisBe\.Core\.Infrastructure/WaterPlatform.BuildingBlocks.Infrastructure/g' \
 -e 's/WaterNetworkGisBe\.Shared\.Persistence/WaterPlatform.BuildingBlocks.Infrastructure.Persistence/g' \
 -e 's/WaterNetworkGisBe\.Shared\.Outbox/WaterPlatform.BuildingBlocks.Infrastructure.Outbox/g' \
 -e 's/WaterNetworkGisBe\.Shared\.Caching/WaterPlatform.BuildingBlocks.Infrastructure.Caching/g' \
 -e 's/WaterNetworkGisBe\.Shared\.Events/WaterPlatform.BuildingBlocks.EventBus/g' \
 -e 's/WaterNetworkGisBe\.Shared\.Observability/WaterPlatform.BuildingBlocks.Observability/g' \
 -e 's/WaterNetworkGisBe\.Shared\.Http/WaterPlatform.BuildingBlocks.WebApi.Http/g' \
 -e 's/WaterNetworkGisBe\.Shared\.Context/WaterPlatform.BuildingBlocks.WebApi.Context/g' \
 -e 's/WaterNetworkGisBe\.Shared\.Bootstrap/WaterPlatform.BuildingBlocks.WebApi.Bootstrap/g' \
 -e 's/AppDbContext/PlatformDbContext/g' \
 {} +
```

- [ ] **Step 4: Build**

Run: `dotnet build building-blocks/WaterPlatform.BuildingBlocks.Domain`
Expected: `Build succeeded`

- [ ] **Step 5: Copy tests Domain từ SAMPLE và chạy**

Tạo `src/building-blocks/tests/WaterPlatform.BuildingBlocks.Domain.Tests/WaterPlatform.BuildingBlocks.Domain.Tests.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../WaterPlatform.BuildingBlocks.Domain/WaterPlatform.BuildingBlocks.Domain.csproj" />
  </ItemGroup>
</Project>
```

```bash
SAMPLE=docs/sample/dotnet-skeleton-sample
DEST=building-blocks/tests/WaterPlatform.BuildingBlocks.Domain.Tests
cp -R $SAMPLE/tests/WaterNetworkGisBe.Core.Tests/Domain $DEST/
find $DEST -name '*.cs' -exec sed -i '' \
 -e 's/WaterNetworkGisBe\.Core\.Tests/WaterPlatform.BuildingBlocks.Domain.Tests/g' \
 -e 's/WaterNetworkGisBe\.Core\.Domain/WaterPlatform.BuildingBlocks.Domain/g' {} +
dotnet sln WaterPlatform.BuildingBlocks.slnx add $DEST
```

Run: `dotnet test building-blocks/tests/WaterPlatform.BuildingBlocks.Domain.Tests`
Expected: PASS (toàn bộ AggregateRoot/ValueObject/Specification tests xanh)

- [ ] **Step 6: Commit**

```bash
git add building-blocks/ WaterPlatform.BuildingBlocks.slnx
git commit -m "feat(building-blocks): extract Domain primitives from skeleton sample"
```

---

### Task 3: WaterPlatform.BuildingBlocks.Application — custom dispatcher thay MediatR (TDD)

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.Application/WaterPlatform.BuildingBlocks.Application.csproj`
- Copy from SAMPLE: `src/libs/WaterNetworkGisBe.Core/Application/**` (TRỪ mọi file nhắc MediatR — kiểm tra bằng grep) ; `src/libs/WaterNetworkGisBe.Core/Common/Context/**`
- Create: `Cqrs/ICommandHandler.cs`, `Cqrs/IQueryHandler.cs`, `Cqrs/ICommandPipelineBehavior.cs`, `Cqrs/CommandBus.cs`, `Cqrs/QueryBus.cs`, `Cqrs/Behaviors/LoggingCommandBehavior.cs`, `Cqrs/Behaviors/IdempotencyCommandBehavior.cs`, `Events/IDomainEventHandler.cs`, `ServiceCollectionExtensions.cs`
- Test: `src/building-blocks/tests/WaterPlatform.BuildingBlocks.Application.Tests/CommandBusTests.cs`, `QueryBusTests.cs`

- [ ] **Step 1: Tạo csproj + copy abstractions**

`src/building-blocks/src/WaterPlatform.BuildingBlocks.Application/WaterPlatform.BuildingBlocks.Application.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.DependencyInjection.Abstractions" VersionOverride="10.0.0" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" VersionOverride="10.0.0" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.Domain/WaterPlatform.BuildingBlocks.Domain.csproj" />
  </ItemGroup>
</Project>
```

(Nếu `VersionOverride` xung đột central package management, thêm 2 dòng `PackageVersion` tương ứng vào `Directory.Packages.props` thay vì dùng VersionOverride.)

```bash
SAMPLE=docs/sample/dotnet-skeleton-sample
DEST=building-blocks/WaterPlatform.BuildingBlocks.Application
cp -R $SAMPLE/src/libs/WaterNetworkGisBe.Core/Application/* $DEST/
mkdir -p $DEST/Context
cp $SAMPLE/src/libs/WaterNetworkGisBe.Core/Common/Context/*.cs $DEST/Context/
grep -rl "MediatR" $DEST && echo "PHAI XOA using MediatR khoi cac file nay" || echo CLEAN
```

Chạy lại bảng sed chuẩn (Task 2 Step 3). Nếu file nào còn `using MediatR;` hoặc kế thừa `IRequest<>` — xóa phần MediatR đó (ICommand/IQuery của SAMPLE vốn là marker interface thuần, xem source: `public interface ICommand<TResult>;`).

- [ ] **Step 2: Viết failing tests cho dispatcher**

`src/building-blocks/tests/WaterPlatform.BuildingBlocks.Application.Tests/CommandBusTests.cs` (csproj test giống Task 2 Step 5, thêm ProjectReference tới Application và `Microsoft.Extensions.DependencyInjection` package):

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Application.Tests;

public sealed record CreateThingCommand(string Name) : ICommand<string>;
public sealed record PingCommand : ICommand;

public sealed class CreateThingHandler : ICommandHandler<CreateThingCommand, string>
{
    public Task<string> HandleAsync(CreateThingCommand command, CancellationToken ct)
        => Task.FromResult($"created:{command.Name}");
}

public sealed class PingHandler : ICommandHandler<PingCommand, Unit>
{
    public static bool Called;
    public Task<Unit> HandleAsync(PingCommand command, CancellationToken ct)
    {
        Called = true;
        return Task.FromResult(default(Unit));
    }
}

public sealed class RecordingBehavior(List<string> log, string name) : ICommandPipelineBehavior
{
    public async Task<TResult> HandleAsync<TCommand, TResult>(
        TCommand command, Func<Task<TResult>> next, CancellationToken ct)
        where TCommand : ICommand<TResult>
    {
        log.Add($"{name}:before");
        var result = await next();
        log.Add($"{name}:after");
        return result;
    }
}

public class CommandBusTests
{
    private static ServiceProvider BuildProvider(Action<IServiceCollection>? extra = null)
    {
        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        services.AddScoped<ICommandHandler<CreateThingCommand, string>, CreateThingHandler>();
        services.AddScoped<ICommandHandler<PingCommand, Unit>, PingHandler>();
        extra?.Invoke(services);
        return services.BuildServiceProvider();
    }

    [Fact]
    public async Task ExecuteAsync_Resolves_Handler_And_Returns_Result()
    {
        await using var sp = BuildProvider();
        var bus = sp.GetRequiredService<ICommandBus>();
        var result = await bus.ExecuteAsync(new CreateThingCommand("a"));
        result.Should().Be("created:a");
    }

    [Fact]
    public async Task ExecuteAsync_Void_Command_Invokes_Handler()
    {
        PingHandler.Called = false;
        await using var sp = BuildProvider();
        var bus = sp.GetRequiredService<ICommandBus>();
        await bus.ExecuteAsync(new PingCommand());
        PingHandler.Called.Should().BeTrue();
    }

    [Fact]
    public async Task ExecuteAsync_Runs_Behaviors_In_Registration_Order()
    {
        var log = new List<string>();
        await using var sp = BuildProvider(s =>
        {
            s.AddScoped<ICommandPipelineBehavior>(_ => new RecordingBehavior(log, "outer"));
            s.AddScoped<ICommandPipelineBehavior>(_ => new RecordingBehavior(log, "inner"));
        });
        var bus = sp.GetRequiredService<ICommandBus>();
        await bus.ExecuteAsync(new CreateThingCommand("a"));
        log.Should().Equal("outer:before", "inner:before", "inner:after", "outer:after");
    }

    [Fact]
    public async Task ExecuteAsync_Throws_When_No_Handler_Registered()
    {
        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        await using var sp = services.BuildServiceProvider();
        var bus = sp.GetRequiredService<ICommandBus>();
        var act = () => bus.ExecuteAsync(new CreateThingCommand("a"));
        await act.Should().ThrowAsync<InvalidOperationException>();
    }
}
```

`QueryBusTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Application.Queries;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Application.Tests;

public sealed record GetThingQuery(string Id) : IQuery<string?>;

public sealed class GetThingHandler : IQueryHandler<GetThingQuery, string?>
{
    public Task<string?> HandleAsync(GetThingQuery query, CancellationToken ct)
        => Task.FromResult<string?>(query.Id == "known" ? "thing" : null);
}

public class QueryBusTests
{
    [Fact]
    public async Task ExecuteAsync_Resolves_Query_Handler()
    {
        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        services.AddScoped<IQueryHandler<GetThingQuery, string?>, GetThingHandler>();
        await using var sp = services.BuildServiceProvider();
        var bus = sp.GetRequiredService<IQueryBus>();
        (await bus.ExecuteAsync(new GetThingQuery("known"))).Should().Be("thing");
        (await bus.ExecuteAsync(new GetThingQuery("other"))).Should().BeNull();
    }
}
```

- [ ] **Step 3: Run tests để xác nhận FAIL**

Run: `dotnet test building-blocks/tests/WaterPlatform.BuildingBlocks.Application.Tests`
Expected: FAIL — compile error (chưa có `ICommandHandler`, `AddPlatformCqrs`…)

- [ ] **Step 4: Implement dispatcher**

`Cqrs/ICommandHandler.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

public interface ICommandHandler<in TCommand, TResult> where TCommand : ICommand<TResult>
{
    Task<TResult> HandleAsync(TCommand command, CancellationToken ct);
}
```

`Cqrs/IQueryHandler.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

public interface IQueryHandler<in TQuery, TResult> where TQuery : IQuery<TResult>
{
    Task<TResult> HandleAsync(TQuery query, CancellationToken ct);
}
```

`Cqrs/ICommandPipelineBehavior.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

public interface ICommandPipelineBehavior
{
    Task<TResult> HandleAsync<TCommand, TResult>(
        TCommand command, Func<Task<TResult>> next, CancellationToken ct)
        where TCommand : ICommand<TResult>;
}
```

`Events/IDomainEventHandler.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterPlatform.BuildingBlocks.Application.Events;

public interface IDomainEventHandler<in TEvent> where TEvent : IDomainEvent
{
    Task HandleAsync(TEvent domainEvent, CancellationToken ct);
}
```

`Cqrs/CommandBus.cs`:

```csharp
using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

internal abstract class CommandHandlerWrapper<TResult>
{
    public abstract Task<TResult> Handle(ICommand<TResult> command, IServiceProvider sp, CancellationToken ct);
}

internal sealed class CommandHandlerWrapperImpl<TCommand, TResult> : CommandHandlerWrapper<TResult>
    where TCommand : ICommand<TResult>
{
    public override Task<TResult> Handle(ICommand<TResult> command, IServiceProvider sp, CancellationToken ct)
    {
        var behaviors = sp.GetServices<ICommandPipelineBehavior>().ToArray();
        Func<Task<TResult>> next = () => sp.GetRequiredService<ICommandHandler<TCommand, TResult>>()
            .HandleAsync((TCommand)command, ct);

        for (var i = behaviors.Length - 1; i >= 0; i--)
        {
            var behavior = behaviors[i];
            var current = next;
            next = () => behavior.HandleAsync<TCommand, TResult>((TCommand)command, current, ct);
        }

        return next();
    }
}

internal sealed class CommandBus(IServiceProvider serviceProvider) : ICommandBus
{
    private static readonly ConcurrentDictionary<Type, object> Wrappers = new();

    public Task<TResult> ExecuteAsync<TResult>(ICommand<TResult> command, CancellationToken ct = default)
    {
        var wrapper = (CommandHandlerWrapper<TResult>)Wrappers.GetOrAdd(command.GetType(), static commandType =>
            Activator.CreateInstance(
                typeof(CommandHandlerWrapperImpl<,>).MakeGenericType(commandType, typeof(TResult)))!);
        return wrapper.Handle(command, serviceProvider, ct);
    }

    public Task ExecuteAsync(ICommand command, CancellationToken ct = default)
        => ExecuteAsync<Unit>(command, ct);
}
```

`Cqrs/QueryBus.cs`:

```csharp
using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

internal abstract class QueryHandlerWrapper<TResult>
{
    public abstract Task<TResult> Handle(IQuery<TResult> query, IServiceProvider sp, CancellationToken ct);
}

internal sealed class QueryHandlerWrapperImpl<TQuery, TResult> : QueryHandlerWrapper<TResult>
    where TQuery : IQuery<TResult>
{
    public override Task<TResult> Handle(IQuery<TResult> query, IServiceProvider sp, CancellationToken ct)
        => sp.GetRequiredService<IQueryHandler<TQuery, TResult>>().HandleAsync((TQuery)query, ct);
}

internal sealed class QueryBus(IServiceProvider serviceProvider) : IQueryBus
{
    private static readonly ConcurrentDictionary<Type, object> Wrappers = new();

    public Task<TResult> ExecuteAsync<TResult>(IQuery<TResult> query, CancellationToken ct = default)
    {
        var wrapper = (QueryHandlerWrapper<TResult>)Wrappers.GetOrAdd(query.GetType(), static queryType =>
            Activator.CreateInstance(
                typeof(QueryHandlerWrapperImpl<,>).MakeGenericType(queryType, typeof(TResult)))!);
        return wrapper.Handle(query, serviceProvider, ct);
    }
}
```

`Cqrs/Behaviors/LoggingCommandBehavior.cs`:

```csharp
using System.Diagnostics;
using Microsoft.Extensions.Logging;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs.Behaviors;

public sealed class LoggingCommandBehavior(ILogger<LoggingCommandBehavior> logger) : ICommandPipelineBehavior
{
    public async Task<TResult> HandleAsync<TCommand, TResult>(
        TCommand command, Func<Task<TResult>> next, CancellationToken ct)
        where TCommand : ICommand<TResult>
    {
        var commandName = typeof(TCommand).Name;
        var sw = Stopwatch.StartNew();
        logger.LogInformation("Executing command {CommandName}", commandName);
        try
        {
            var result = await next();
            logger.LogInformation("Executed command {CommandName} in {ElapsedMs}ms", commandName, sw.ElapsedMilliseconds);
            return result;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Command {CommandName} failed after {ElapsedMs}ms", commandName, sw.ElapsedMilliseconds);
            throw;
        }
    }
}
```

`Cqrs/Behaviors/IdempotencyCommandBehavior.cs` (port từ `SAMPLE/src/libs/WaterNetworkGisBe.Shared/Cqrs/Behaviors/MediatRIdempotencyBehavior.cs`, cùng semantics):

```csharp
using System.Text.Json;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs.Behaviors;

public sealed class IdempotencyCommandBehavior(IIdempotencyService idempotencyService) : ICommandPipelineBehavior
{
    public async Task<TResult> HandleAsync<TCommand, TResult>(
        TCommand command, Func<Task<TResult>> next, CancellationToken ct)
        where TCommand : ICommand<TResult>
    {
        if (command is not IIdempotentCommand<TResult> idempotent)
        {
            return await next();
        }

        if (await idempotencyService.HasBeenProcessedAsync(idempotent.IdempotencyKey, ct))
        {
            var cachedResult = await idempotencyService.GetResultAsync<TResult>(idempotent.IdempotencyKey, ct);
            if (cachedResult is not null) return cachedResult;
        }

        var result = await next();

        await idempotencyService.MarkAsProcessedAsync(
            idempotent.IdempotencyKey, JsonSerializer.Serialize(result), ct);

        return result;
    }
}
```

`ServiceCollectionExtensions.cs`:

```csharp
using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Application.Cqrs.Behaviors;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterPlatform.BuildingBlocks.Application;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPlatformCqrs(this IServiceCollection services)
    {
        services.AddScoped<ICommandBus, CommandBus>();
        services.AddScoped<IQueryBus, QueryBus>();
        return services;
    }

    public static IServiceCollection AddPlatformCqrsBehaviors(this IServiceCollection services)
    {
        services.AddScoped<ICommandPipelineBehavior, LoggingCommandBehavior>();
        services.AddScoped<ICommandPipelineBehavior, IdempotencyCommandBehavior>();
        return services;
    }

    public static IServiceCollection AddHandlersFromAssembly(this IServiceCollection services, Assembly assembly)
    {
        var handlerInterfaces = new[]
        {
            typeof(ICommandHandler<,>), typeof(IQueryHandler<,>), typeof(IDomainEventHandler<>)
        };

        foreach (var type in assembly.GetTypes().Where(t => t is { IsAbstract: false, IsInterface: false }))
        {
            foreach (var iface in type.GetInterfaces().Where(i =>
                i.IsGenericType && handlerInterfaces.Contains(i.GetGenericTypeDefinition())))
            {
                services.AddScoped(iface, type);
            }
        }

        return services;
    }
}
```

- [ ] **Step 5: Run tests để xác nhận PASS**

Run: `dotnet test building-blocks/tests/WaterPlatform.BuildingBlocks.Application.Tests`
Expected: PASS — 5 tests xanh

- [ ] **Step 6: Add vào solution + commit**

```bash
dotnet sln WaterPlatform.BuildingBlocks.slnx add building-blocks/WaterPlatform.BuildingBlocks.Application building-blocks/tests/WaterPlatform.BuildingBlocks.Application.Tests
git add building-blocks/ WaterPlatform.BuildingBlocks.slnx Directory.Packages.props
git commit -m "feat(building-blocks): custom CQRS dispatcher replacing MediatR with pipeline behaviors"
```

---

### Task 4: WaterPlatform.BuildingBlocks.Infrastructure — PlatformDbContext, Outbox/Inbox, DomainEventDispatcher

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.Infrastructure/WaterPlatform.BuildingBlocks.Infrastructure.csproj`
- Copy from SAMPLE (sau đó sed): `src/libs/WaterNetworkGisBe.Core/Infrastructure/**` ; `src/libs/WaterNetworkGisBe.Shared/Outbox/**` ; `src/libs/WaterNetworkGisBe.Shared/Caching/**` ; từ `src/libs/WaterNetworkGisBe.Shared/Persistence/`: `UnitOfWork.cs`, `TransactionContext.cs`, `IdempotencyService.cs`, `InboxMessageStore.cs`, `ProcessedEventEntry.cs`, `ProcessedEventStore.cs`, `DatabaseMigrationExtensions.cs`, `Sql/SqlReadDao.cs`, `Configurations/IdempotencyEntryConfiguration.cs`, `Configurations/OutboxConfiguration.cs`
- Create: `Persistence/PlatformDbContext.cs`, `Events/DomainEventDispatcher.cs`, `ServiceCollectionExtensions.cs`

- [ ] **Step 1: csproj**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore" />
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" />
    <PackageReference Include="Dapper" />
    <PackageReference Include="StackExchange.Redis" />
    <PackageReference Include="Microsoft.Extensions.Caching.StackExchangeRedis" />
    <PackageReference Include="Microsoft.Extensions.Hosting.Abstractions" VersionOverride="10.0.0" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.Domain/WaterPlatform.BuildingBlocks.Domain.csproj" />
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.Application/WaterPlatform.BuildingBlocks.Application.csproj" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: Copy files theo danh sách trên, chạy lại sed chuẩn (Task 2 Step 3)**

```bash
SAMPLE=docs/sample/dotnet-skeleton-sample
DEST=building-blocks/WaterPlatform.BuildingBlocks.Infrastructure
mkdir -p $DEST/Persistence/Configurations $DEST/Persistence/Sql $DEST/Outbox $DEST/Caching $DEST/Events
cp -R $SAMPLE/src/libs/WaterNetworkGisBe.Core/Infrastructure/* $DEST/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Outbox/*.cs $DEST/Outbox/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Caching/*.cs $DEST/Caching/
for f in UnitOfWork TransactionContext IdempotencyService InboxMessageStore ProcessedEventEntry ProcessedEventStore DatabaseMigrationExtensions; do
  cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Persistence/$f.cs $DEST/Persistence/
done
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Persistence/Sql/SqlReadDao.cs $DEST/Persistence/Sql/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Persistence/Configurations/IdempotencyEntryConfiguration.cs $DEST/Persistence/Configurations/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Persistence/Configurations/OutboxConfiguration.cs $DEST/Persistence/Configurations/
```

Sau đó chạy bảng sed chuẩn. Lưu ý sed đã đổi `AppDbContext` → `PlatformDbContext` trong mọi file copy.

- [ ] **Step 3: Tạo `Persistence/PlatformDbContext.cs`** (thay cho AppDbContext của SAMPLE — abstract để mỗi service kế thừa, chỉ chứa platform tables)

```csharp
using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public abstract class PlatformDbContext : DbContext
{
    protected PlatformDbContext(DbContextOptions options) : base(options) { }

    public DbSet<OutboxEntry> OutboxEntries => Set<OutboxEntry>();
    public DbSet<IdempotencyEntry> IdempotencyEntries => Set<IdempotencyEntry>();
    public DbSet<ProcessedEventEntry> ProcessedEvents => Set<ProcessedEventEntry>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PlatformDbContext).Assembly);
    }
}
```

Lưu ý kiểm tra sau build: `OutboxEntry` namespace sau sed là `WaterPlatform.BuildingBlocks.Infrastructure.Outbox`; `IdempotencyEntry`/`ProcessedEventEntry` nằm trong `Infrastructure.Persistence`. Nếu `IdempotencyEntry` được khai báo trong `IdempotencyService.cs`, giữ nguyên. Constructor copy của các file dùng `PlatformDbContext` (đã sed) khớp luôn vì cùng tên.

- [ ] **Step 4: Tạo `Events/DomainEventDispatcher.cs`** (viết lại không MediatR; xóa file `DomainEventNotification.cs` nếu được copy nhầm)

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

internal sealed class DomainEventDispatcher(
    IServiceProvider serviceProvider,
    ILogger<DomainEventDispatcher> logger) : IDomainEventDispatcher
{
    public async Task DispatchAsync(IEnumerable<IDomainEvent> events, CancellationToken ct = default)
    {
        foreach (var domainEvent in events)
        {
            var handlerType = typeof(IDomainEventHandler<>).MakeGenericType(domainEvent.GetType());
            var handleMethod = handlerType.GetMethod(nameof(IDomainEventHandler<IDomainEvent>.HandleAsync))!;

            foreach (var handler in serviceProvider.GetServices(handlerType))
            {
                if (handler is null) continue;
                try
                {
                    await (Task)handleMethod.Invoke(handler, [domainEvent, ct])!;
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Failed to dispatch domain event {EventType} for aggregate {AggregateId}",
                        domainEvent.EventType, domainEvent.AggregateId);
                    throw;
                }
            }
        }
    }
}
```

- [ ] **Step 5: Tạo `ServiceCollectionExtensions.cs`** (per-service persistence — thay AddPersistence của SAMPLE vốn bind 1 AppDbContext)

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Caching;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterPlatform.BuildingBlocks.Infrastructure;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPlatformPersistence<TContext>(
        this IServiceCollection services,
        IConfiguration configuration,
        Action<Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure.NpgsqlDbContextOptionsBuilder>? npgsql = null)
        where TContext : PlatformDbContext
    {
        var connectionString = configuration.GetConnectionString("PostgreSQL")
            ?? throw new InvalidOperationException("ConnectionStrings:PostgreSQL is required.");

        services.AddDbContext<TContext>(options =>
            options.UseNpgsql(connectionString, o =>
            {
                o.MigrationsAssembly(typeof(TContext).Assembly.FullName);
                npgsql?.Invoke(o);
            }));
        services.AddScoped<PlatformDbContext>(sp => sp.GetRequiredService<TContext>());

        services.AddScoped<IUnitOfWork, UnitOfWork>();
        services.AddScoped<IIdempotencyService, IdempotencyService>();
        services.AddScoped<IInboxMessageStore, InboxMessageStore>();
        services.AddScoped<IProcessedEventStore, ProcessedEventStore>();
        services.AddScoped<IDomainEventDispatcher, DomainEventDispatcher>();
        return services;
    }

    public static IServiceCollection AddPlatformOutbox(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<OutboxOptions>(configuration.GetSection(OutboxOptions.SectionName));
        services.AddScoped<IOutboxRepository, OutboxRepository>();
        services.AddSingleton<IOutboxProcessor>(sp =>
        {
            var scopeFactory = sp.GetRequiredService<IServiceScopeFactory>();
            var logger = sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<OutboxProcessor>>();
            var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<OutboxOptions>>();
            return new OutboxProcessor(scopeFactory, logger, options);
        });
        services.AddHostedService(sp => (OutboxProcessor)sp.GetRequiredService<IOutboxProcessor>());
        return services;
    }

    public static IServiceCollection AddPlatformRedisCache(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Redis");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            services.AddDistributedMemoryCache();
        }
        else
        {
            services.AddStackExchangeRedisCache(options =>
            {
                options.Configuration = connectionString;
                options.InstanceName = configuration["Redis:InstanceName"] ?? "WaterPlatform:";
            });
        }
        services.AddSingleton<ICacheService, RedisCacheService>();
        return services;
    }
}
```

Nếu interface `IReadDao`/`SqlReadDao` (copy từ SAMPLE) yêu cầu đăng ký, để service tự đăng ký trong module của nó — KHÔNG đăng ký mặc định ở đây. Xóa các phần của file copy tham chiếu tới `ServiceCollectionExtensions` cũ của SAMPLE nếu trùng.

- [ ] **Step 6: Build + commit**

Run: `dotnet sln WaterPlatform.BuildingBlocks.slnx add building-blocks/WaterPlatform.BuildingBlocks.Infrastructure && dotnet build WaterPlatform.BuildingBlocks.slnx`
Expected: `Build succeeded`. Nếu lỗi thiếu type (ví dụ entity khai báo trong file chưa copy) — copy đúng file chứa type đó từ `SAMPLE/src/libs/WaterNetworkGisBe.Shared/Persistence/` rồi sed lại.

```bash
git add building-blocks/ WaterPlatform.BuildingBlocks.slnx
git commit -m "feat(building-blocks): infrastructure with PlatformDbContext, outbox/inbox, DI-based domain event dispatcher"
```

---

### Task 5: WaterPlatform.BuildingBlocks.MultiTenancy (TDD)

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.MultiTenancy/WaterPlatform.BuildingBlocks.MultiTenancy.csproj`, `TenantContext.cs`, `ITenantContextAccessor.cs`, `TenantContextAccessor.cs`, `TenantOptions.cs`, `TenantResolutionMiddleware.cs`, `ServiceCollectionExtensions.cs`
- Test: `src/building-blocks/tests/WaterPlatform.BuildingBlocks.MultiTenancy.Tests/TenantResolutionMiddlewareTests.cs`

- [ ] **Step 1: csproj** (cần ASP.NET cho middleware)

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: Viết failing tests**

`src/building-blocks/tests/WaterPlatform.BuildingBlocks.MultiTenancy.Tests/TenantResolutionMiddlewareTests.cs` (csproj test: xunit + FluentAssertions + FrameworkReference AspNetCore.App + ProjectReference MultiTenancy):

```csharp
using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterPlatform.BuildingBlocks.MultiTenancy.Tests;

public class TenantResolutionMiddlewareTests
{
    private static async Task<TenantContext?> RunMiddleware(
        HttpContext httpContext, TenantOptions options, TenantContextAccessor accessor)
    {
        TenantContext? captured = null;
        var middleware = new TenantResolutionMiddleware(
            _ => { captured = accessor.Current; return Task.CompletedTask; },
            Options.Create(options));
        await middleware.InvokeAsync(httpContext, accessor);
        return captured;
    }

    [Fact]
    public async Task Resolves_Tenant_From_Jwt_Claims()
    {
        var ctx = new DefaultHttpContext();
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("tenant_id", "tenant-001"),
            new Claim("organization_id", "org-001"),
            new Claim("branch_id", "branch-001")
        ], authenticationType: "test"));

        var captured = await RunMiddleware(ctx, new TenantOptions(), new TenantContextAccessor());

        captured.Should().NotBeNull();
        captured!.TenantId.Should().Be("tenant-001");
        captured.OrganizationId.Should().Be("org-001");
        captured.BranchId.Should().Be("branch-001");
    }

    [Fact]
    public async Task Falls_Back_To_Header_When_Allowed()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["X-Tenant-Id"] = "tenant-from-header";

        var captured = await RunMiddleware(ctx, new TenantOptions { AllowHeaderFallback = true }, new TenantContextAccessor());

        captured.Should().NotBeNull();
        captured!.TenantId.Should().Be("tenant-from-header");
    }

    [Fact]
    public async Task Ignores_Header_When_Fallback_Disabled()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["X-Tenant-Id"] = "tenant-from-header";

        var captured = await RunMiddleware(ctx, new TenantOptions { AllowHeaderFallback = false }, new TenantContextAccessor());

        captured.Should().BeNull();
    }

    [Fact]
    public async Task Claim_Wins_Over_Header()
    {
        var ctx = new DefaultHttpContext();
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("tenant_id", "tenant-claim")], authenticationType: "test"));
        ctx.Request.Headers["X-Tenant-Id"] = "tenant-header";

        var captured = await RunMiddleware(ctx, new TenantOptions { AllowHeaderFallback = true }, new TenantContextAccessor());

        captured!.TenantId.Should().Be("tenant-claim");
    }
}
```

- [ ] **Step 3: Run tests, xác nhận FAIL (compile error)**

Run: `dotnet test building-blocks/tests/WaterPlatform.BuildingBlocks.MultiTenancy.Tests`
Expected: FAIL — chưa có types

- [ ] **Step 4: Implement**

`TenantContext.cs`:

```csharp
namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public sealed record TenantContext(string TenantId, string? OrganizationId = null, string? BranchId = null);
```

`ITenantContextAccessor.cs`:

```csharp
namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public interface ITenantContextAccessor
{
    TenantContext? Current { get; }
    void Set(TenantContext? context);
}
```

`TenantContextAccessor.cs`:

```csharp
namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public sealed class TenantContextAccessor : ITenantContextAccessor
{
    private static readonly AsyncLocal<TenantContext?> Holder = new();
    public TenantContext? Current => Holder.Value;
    public void Set(TenantContext? context) => Holder.Value = context;
}
```

`TenantOptions.cs`:

```csharp
namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public sealed class TenantOptions
{
    public const string SectionName = "MultiTenancy";
    public bool AllowHeaderFallback { get; set; }
    public string TenantClaim { get; set; } = "tenant_id";
    public string OrganizationClaim { get; set; } = "organization_id";
    public string BranchClaim { get; set; } = "branch_id";
    public string TenantHeader { get; set; } = "X-Tenant-Id";
}
```

`TenantResolutionMiddleware.cs`:

```csharp
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public sealed class TenantResolutionMiddleware(RequestDelegate next, IOptions<TenantOptions> options)
{
    public async Task InvokeAsync(HttpContext httpContext, ITenantContextAccessor accessor)
    {
        var opts = options.Value;
        var tenantId = httpContext.User.FindFirst(opts.TenantClaim)?.Value;

        if (string.IsNullOrEmpty(tenantId) && opts.AllowHeaderFallback
            && httpContext.Request.Headers.TryGetValue(opts.TenantHeader, out var headerValue))
        {
            tenantId = headerValue.ToString();
        }

        accessor.Set(string.IsNullOrEmpty(tenantId)
            ? null
            : new TenantContext(
                tenantId,
                httpContext.User.FindFirst(opts.OrganizationClaim)?.Value,
                httpContext.User.FindFirst(opts.BranchClaim)?.Value));

        try
        {
            await next(httpContext);
        }
        finally
        {
            accessor.Set(null);
        }
    }
}
```

`ServiceCollectionExtensions.cs`:

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPlatformMultiTenancy(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<TenantOptions>(configuration.GetSection(TenantOptions.SectionName));
        services.AddSingleton<ITenantContextAccessor, TenantContextAccessor>();
        return services;
    }

    public static IApplicationBuilder UsePlatformMultiTenancy(this IApplicationBuilder app)
        => app.UseMiddleware<TenantResolutionMiddleware>();
}
```

- [ ] **Step 5: Run tests, xác nhận PASS (4 tests)**

Run: `dotnet test building-blocks/tests/WaterPlatform.BuildingBlocks.MultiTenancy.Tests`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
dotnet sln WaterPlatform.BuildingBlocks.slnx add building-blocks/WaterPlatform.BuildingBlocks.MultiTenancy building-blocks/tests/WaterPlatform.BuildingBlocks.MultiTenancy.Tests
git add building-blocks/ WaterPlatform.BuildingBlocks.slnx
git commit -m "feat(building-blocks): multi-tenancy context with JWT claim and header fallback resolution"
```

---

### Task 6: WaterPlatform.BuildingBlocks.EventBus — envelope spec §16 + MassTransit

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.EventBus/WaterPlatform.BuildingBlocks.EventBus.csproj`, `IntegrationEventEnvelope.cs`, `EventBusOptions.cs`, `MassTransitIntegrationEventPublisher.cs`, `MassTransitConfiguration.cs`
- Copy from SAMPLE: `src/libs/WaterNetworkGisBe.Shared/Events/Integration/SerializedDomainEventIntegrationEventMapper.cs`, `IdempotentIntegrationEventConsumer.cs`, `Contracts/IntegrationEventBase.cs` (KHÔNG copy Order/Product contracts, KHÔNG copy `IntegrationEventEnvelope.cs`/`MassTransitConfiguration.cs`/`MassTransitIntegrationEventPublisher.cs` của SAMPLE — viết mới)

- [ ] **Step 1: csproj**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="MassTransit" />
    <PackageReference Include="MassTransit.RabbitMQ" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.Infrastructure/WaterPlatform.BuildingBlocks.Infrastructure.csproj" />
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.MultiTenancy/WaterPlatform.BuildingBlocks.MultiTenancy.csproj" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: Copy 3 file từ SAMPLE rồi chạy sed chuẩn**

```bash
SAMPLE=docs/sample/dotnet-skeleton-sample
DEST=building-blocks/WaterPlatform.BuildingBlocks.EventBus
mkdir -p $DEST/Integration/Contracts
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Events/Integration/SerializedDomainEventIntegrationEventMapper.cs $DEST/Integration/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Events/Integration/IdempotentIntegrationEventConsumer.cs $DEST/Integration/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Events/Integration/Contracts/IntegrationEventBase.cs $DEST/Integration/Contracts/
```

- [ ] **Step 3: `IntegrationEventEnvelope.cs`** — envelope đầy đủ theo spec §16

```csharp
namespace WaterPlatform.BuildingBlocks.EventBus.Integration;

public sealed record IntegrationEventEnvelope(
    string EventId,
    string EventType,
    int EventVersion,
    DateTime OccurredAt,
    string? TenantId,
    string? OrganizationId,
    string? BranchId,
    string? CorrelationId,
    string? CausationId,
    string Producer,
    string Payload);
```

- [ ] **Step 4: `EventBusOptions.cs` + `MassTransitIntegrationEventPublisher.cs`**

```csharp
namespace WaterPlatform.BuildingBlocks.EventBus;

public sealed class EventBusOptions
{
    public const string SectionName = "EventBus";
    public string Producer { get; set; } = "unknown-service";
    public string Transport { get; set; } = "RabbitMq"; // RabbitMq | InMemory
}
```

```csharp
using System.Text.Json;
using MassTransit;
using Microsoft.Extensions.Options;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterPlatform.BuildingBlocks.EventBus;

internal sealed class MassTransitIntegrationEventPublisher(
    IPublishEndpoint publishEndpoint,
    ITenantContextAccessor tenantAccessor,
    IOptions<EventBusOptions> options) : IIntegrationEventPublisher
{
    public async Task PublishAsync(IIntegrationEvent integrationEvent, CancellationToken ct = default)
    {
        var tenant = tenantAccessor.Current;
        var envelope = new IntegrationEventEnvelope(
            EventId: integrationEvent.EventId,
            EventType: integrationEvent.EventType,
            EventVersion: integrationEvent.EventVersion,
            OccurredAt: integrationEvent.OccurredAt,
            TenantId: tenant?.TenantId,
            OrganizationId: tenant?.OrganizationId,
            BranchId: tenant?.BranchId,
            CorrelationId: System.Diagnostics.Activity.Current?.TraceId.ToString(),
            CausationId: integrationEvent.SourceAggregateId,
            Producer: options.Value.Producer,
            Payload: JsonSerializer.Serialize(integrationEvent, integrationEvent.GetType()));

        await publishEndpoint.Publish(envelope, ct);
    }
}
```

Nếu `IIntegrationEventPublisher` (interface copy từ SAMPLE) có chữ ký khác (`PublishAsync` nhiều overload), implement đủ các overload theo interface đã copy — mở file `src/building-blocks/src/WaterPlatform.BuildingBlocks.Infrastructure/Events/IIntegrationEventPublisher.cs` để đối chiếu trước khi viết.

- [ ] **Step 5: `MassTransitConfiguration.cs`** — hỗ trợ InMemory transport cho test

```csharp
using MassTransit;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterPlatform.BuildingBlocks.EventBus;

public static class MassTransitConfiguration
{
    public static IServiceCollection AddPlatformEventBus(
        this IServiceCollection services,
        IConfiguration configuration,
        Action<IBusRegistrationConfigurator>? configureConsumers = null)
    {
        services.Configure<EventBusOptions>(configuration.GetSection(EventBusOptions.SectionName));
        services.AddScoped<IIntegrationEventPublisher, MassTransitIntegrationEventPublisher>();

        var transport = configuration[$"{EventBusOptions.SectionName}:Transport"] ?? "RabbitMq";

        services.AddMassTransit(bus =>
        {
            configureConsumers?.Invoke(bus);

            if (string.Equals(transport, "InMemory", StringComparison.OrdinalIgnoreCase))
            {
                bus.UsingInMemory((context, cfg) => cfg.ConfigureEndpoints(context));
            }
            else
            {
                bus.UsingRabbitMq((context, cfg) =>
                {
                    cfg.Host(configuration["MassTransit:RabbitMq:Host"] ?? "localhost", h =>
                    {
                        h.Username(configuration["MassTransit:RabbitMq:Username"] ?? "guest");
                        h.Password(configuration["MassTransit:RabbitMq:Password"] ?? "guest");
                    });
                    cfg.ConfigureEndpoints(context);
                });
            }
        });

        return services;
    }
}
```

- [ ] **Step 6: Build + commit**

Run: `dotnet sln WaterPlatform.BuildingBlocks.slnx add building-blocks/WaterPlatform.BuildingBlocks.EventBus && dotnet build WaterPlatform.BuildingBlocks.slnx`
Expected: `Build succeeded`. Nếu file copy `SerializedDomainEventIntegrationEventMapper`/`IdempotentIntegrationEventConsumer` tham chiếu envelope cũ với chữ ký khác → cập nhật chỗ tham chiếu sang envelope mới (giữ logic, đổi tên field).

```bash
git add building-blocks/ WaterPlatform.BuildingBlocks.slnx
git commit -m "feat(building-blocks): event bus with spec-compliant envelope and InMemory/RabbitMq transports"
```

---

### Task 7: WaterPlatform.BuildingBlocks.Security — mock JWT + permission policies

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.Security/WaterPlatform.BuildingBlocks.Security.csproj`, `JwtOptions.cs`, `DevJwtTokenFactory.cs`, `ServiceCollectionExtensions.cs`

- [ ] **Step 1: csproj**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: `JwtOptions.cs`**

```csharp
namespace WaterPlatform.BuildingBlocks.Security;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";
    public string Mode { get; set; } = "Mock"; // Mock | Authority (Keycloak thật — cập nhật sau)
    public string Issuer { get; set; } = "water-platform-dev";
    public string Audience { get; set; } = "water-platform";
    public string MockSigningKey { get; set; } = "water-platform-dev-signing-key-min-32-chars!";
    public string? Authority { get; set; }
}
```

- [ ] **Step 3: `DevJwtTokenFactory.cs`** (mock Keycloak — dùng cho dev + integration tests)

```csharp
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace WaterPlatform.BuildingBlocks.Security;

public static class DevJwtTokenFactory
{
    public static string CreateToken(
        JwtOptions options,
        string subject,
        string tenantId,
        string? organizationId = null,
        string? branchId = null,
        params string[] permissions)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, subject),
            new("tenant_id", tenantId)
        };
        if (organizationId is not null) claims.Add(new Claim("organization_id", organizationId));
        if (branchId is not null) claims.Add(new Claim("branch_id", branchId));
        claims.AddRange(permissions.Select(p => new Claim("permission", p)));

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.MockSigningKey)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: options.Issuer,
            audience: options.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
```

- [ ] **Step 4: `ServiceCollectionExtensions.cs`**

```csharp
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace WaterPlatform.BuildingBlocks.Security;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPlatformAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(jwt =>
            {
                if (string.Equals(options.Mode, "Authority", StringComparison.OrdinalIgnoreCase))
                {
                    // Keycloak thật — bật khi tích hợp thực tế, chỉ đổi config
                    jwt.Authority = options.Authority;
                    jwt.Audience = options.Audience;
                }
                else
                {
                    jwt.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidIssuer = options.Issuer,
                        ValidAudience = options.Audience,
                        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.MockSigningKey)),
                        ValidateIssuerSigningKey = true
                    };
                }
            });

        services.AddAuthorization();
        return services;
    }

    public static TBuilder RequirePermission<TBuilder>(this TBuilder builder, string permission)
        where TBuilder : IEndpointConventionBuilder
        => builder.RequireAuthorization(policy => policy.RequireClaim("permission", permission));
}
```

- [ ] **Step 5: Build + commit**

Run: `dotnet sln WaterPlatform.BuildingBlocks.slnx add building-blocks/WaterPlatform.BuildingBlocks.Security && dotnet build WaterPlatform.BuildingBlocks.slnx`
Expected: `Build succeeded`

```bash
git add building-blocks/ WaterPlatform.BuildingBlocks.slnx
git commit -m "feat(building-blocks): mock JWT authentication and permission policies"
```

---

### Task 8: Observability + WebApi (Minimal API bootstrap)

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.Observability/WaterPlatform.BuildingBlocks.Observability.csproj`
- Copy from SAMPLE: `src/libs/WaterNetworkGisBe.Shared/Observability/ServiceCollectionExtensions.cs` ; Bootstrap `LoggingBootstrap.cs`, `HealthCheckBootstrap.cs`
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.WebApi/WaterPlatform.BuildingBlocks.WebApi.csproj`, `Endpoints/IEndpointModule.cs`, `Endpoints/EndpointModuleExtensions.cs`, `Validation/ValidationEndpointFilter.cs`, `Bootstrap/PlatformWebApiExtensions.cs`
- Copy from SAMPLE vào WebApi: `src/libs/WaterNetworkGisBe.Shared/Http/{ApiResponse.cs,GlobalExceptionMiddleware.cs,HttpMiddlewareExtensions.cs,PaginationDto.cs}`, `src/libs/WaterNetworkGisBe.Shared/Context/{CorrelationIdMiddleware.cs,RequestContextProvider.cs}`

- [ ] **Step 1: Observability csproj + copy + sed**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Serilog" />
    <PackageReference Include="Serilog.AspNetCore" />
    <PackageReference Include="Serilog.Sinks.Console" />
    <PackageReference Include="Serilog.Sinks.Grafana.Loki" />
    <PackageReference Include="OpenTelemetry" />
    <PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" />
    <PackageReference Include="OpenTelemetry.Exporter.Prometheus.AspNetCore" />
    <PackageReference Include="OpenTelemetry.Extensions.Hosting" />
    <PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" />
    <PackageReference Include="OpenTelemetry.Instrumentation.EntityFrameworkCore" />
    <PackageReference Include="OpenTelemetry.Instrumentation.Http" />
    <PackageReference Include="AspNetCore.HealthChecks.NpgSql" />
    <PackageReference Include="AspNetCore.HealthChecks.Redis" />
    <PackageReference Include="AspNetCore.HealthChecks.Rabbitmq" />
  </ItemGroup>
</Project>
```

```bash
SAMPLE=docs/sample/dotnet-skeleton-sample
DEST=building-blocks/WaterPlatform.BuildingBlocks.Observability
mkdir -p $DEST
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Observability/ServiceCollectionExtensions.cs $DEST/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Bootstrap/LoggingBootstrap.cs $DEST/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Bootstrap/HealthCheckBootstrap.cs $DEST/
```

Chạy sed chuẩn; sửa namespace 2 file Bootstrap thành `WaterPlatform.BuildingBlocks.Observability`. Nếu `HealthCheckBootstrap` tham chiếu type không copy (vd AppDbContext) → đổi health check DB sang `AddNpgSql(configuration.GetConnectionString("PostgreSQL")!)`.

- [ ] **Step 2: WebApi csproj + copy Http/Context từ SAMPLE + sed**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="FluentValidation" />
    <PackageReference Include="FluentValidation.DependencyInjectionExtensions" />
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" />
    <PackageReference Include="Scalar.AspNetCore" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.Application/WaterPlatform.BuildingBlocks.Application.csproj" />
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.Domain/WaterPlatform.BuildingBlocks.Domain.csproj" />
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.MultiTenancy/WaterPlatform.BuildingBlocks.MultiTenancy.csproj" />
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.Security/WaterPlatform.BuildingBlocks.Security.csproj" />
    <ProjectReference Include="../WaterPlatform.BuildingBlocks.Observability/WaterPlatform.BuildingBlocks.Observability.csproj" />
  </ItemGroup>
</Project>
```

```bash
DEST=building-blocks/WaterPlatform.BuildingBlocks.WebApi
mkdir -p $DEST/Http $DEST/Context $DEST/Endpoints $DEST/Validation $DEST/Bootstrap
for f in ApiResponse GlobalExceptionMiddleware HttpMiddlewareExtensions PaginationDto; do
  cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Http/$f.cs $DEST/Http/
done
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Context/CorrelationIdMiddleware.cs $DEST/Context/
cp $SAMPLE/src/libs/WaterNetworkGisBe.Shared/Context/RequestContextProvider.cs $DEST/Context/
```

Chạy sed chuẩn. KHÔNG copy `ValidationFilter.cs` (MVC filter — thay bằng endpoint filter mới bên dưới). KHÔNG copy `WebApiBootstrap.cs`/`AuthenticationBootstrap.cs`/`ApplicationMiddlewareExtensions.cs` (Controllers-based — thay mới).

- [ ] **Step 3: `Endpoints/IEndpointModule.cs` + `EndpointModuleExtensions.cs`**

```csharp
using Microsoft.AspNetCore.Routing;

namespace WaterPlatform.BuildingBlocks.WebApi.Endpoints;

public interface IEndpointModule
{
    void MapEndpoints(IEndpointRouteBuilder app);
}
```

```csharp
using System.Reflection;
using Microsoft.AspNetCore.Routing;

namespace WaterPlatform.BuildingBlocks.WebApi.Endpoints;

public static class EndpointModuleExtensions
{
    public static IEndpointRouteBuilder MapEndpointModules(this IEndpointRouteBuilder app, Assembly assembly)
    {
        var modules = assembly.GetTypes()
            .Where(t => t is { IsAbstract: false, IsInterface: false } && typeof(IEndpointModule).IsAssignableFrom(t))
            .Select(t => (IEndpointModule)Activator.CreateInstance(t)!);

        foreach (var module in modules)
        {
            module.MapEndpoints(app);
        }

        return app;
    }
}
```

- [ ] **Step 4: `Validation/ValidationEndpointFilter.cs`**

```csharp
using FluentValidation;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace WaterPlatform.BuildingBlocks.WebApi.Validation;

public sealed class ValidationEndpointFilter<TRequest> : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.Arguments.OfType<TRequest>().FirstOrDefault();
        if (request is not null)
        {
            var validator = context.HttpContext.RequestServices.GetService<IValidator<TRequest>>();
            if (validator is not null)
            {
                var result = await validator.ValidateAsync(request, context.HttpContext.RequestAborted);
                if (!result.IsValid)
                {
                    return Results.ValidationProblem(result.ToDictionary());
                }
            }
        }
        return await next(context);
    }
}

public static class ValidationEndpointFilterExtensions
{
    public static RouteHandlerBuilder WithValidation<TRequest>(this RouteHandlerBuilder builder)
        => builder.AddEndpointFilter<ValidationEndpointFilter<TRequest>>();
}
```

- [ ] **Step 5: `Bootstrap/PlatformWebApiExtensions.cs`**

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Context;
using WaterPlatform.BuildingBlocks.WebApi.Http;

namespace WaterPlatform.BuildingBlocks.WebApi.Bootstrap;

public static class PlatformWebApiExtensions
{
    public static IServiceCollection AddPlatformWebApi(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddHttpContextAccessor();
        services.AddSingleton<IRequestContextProvider, RequestContextProvider>();
        services.AddOpenApi();
        services.AddProblemDetails();
        services.AddPlatformMultiTenancy(configuration);
        services.AddPlatformAuthentication(configuration);
        return services;
    }

    public static WebApplication UsePlatformWebApi(this WebApplication app)
    {
        app.UseMiddleware<GlobalExceptionMiddleware>();
        app.UseMiddleware<CorrelationIdMiddleware>();
        app.UseAuthentication();
        app.UsePlatformMultiTenancy();
        app.UseAuthorization();
        app.MapOpenApi();
        return app;
    }
}
```

Nếu tên class trong file copy khác (`GlobalExceptionMiddleware` đăng ký kiểu khác, `RequestContextProvider` ctor cần tham số) — đối chiếu file đã copy và chỉnh lời gọi cho khớp, KHÔNG đổi file copy.

- [ ] **Step 6: Build + commit**

Run: `dotnet sln WaterPlatform.BuildingBlocks.slnx add building-blocks/WaterPlatform.BuildingBlocks.Observability building-blocks/WaterPlatform.BuildingBlocks.WebApi && dotnet build WaterPlatform.BuildingBlocks.slnx`
Expected: `Build succeeded`

```bash
git add building-blocks/ WaterPlatform.BuildingBlocks.slnx
git commit -m "feat(building-blocks): observability extraction and minimal-api web bootstrap with endpoint modules"
```

---

### Task 9: WaterPlatform.BuildingBlocks.Testing — Testcontainers fixtures

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.Testing/WaterPlatform.BuildingBlocks.Testing.csproj`, `PostgisFixture.cs`

- [ ] **Step 1: csproj**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Testcontainers.PostgreSql" />
    <PackageReference Include="Testcontainers.RabbitMq" />
    <PackageReference Include="xunit" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: `PostgisFixture.cs`**

```csharp
using Testcontainers.PostgreSql;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Testing;

public sealed class PostgisFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder()
        .WithImage("postgis/postgis:16-3.4-alpine")
        .WithDatabase("wn_test")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    public string ConnectionString => _container.GetConnectionString();

    public Task InitializeAsync() => _container.StartAsync();
    public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}
```

- [ ] **Step 3: Build + commit**

Run: `dotnet sln WaterPlatform.BuildingBlocks.slnx add building-blocks/WaterPlatform.BuildingBlocks.Testing && dotnet build WaterPlatform.BuildingBlocks.slnx`
Expected: `Build succeeded`

```bash
git add building-blocks/ WaterPlatform.BuildingBlocks.slnx
git commit -m "feat(building-blocks): testcontainers postgis fixture"
```

---

### Task 10: Scaffold `water-network-gis-be` + health check integration test

**Files:**
- Create: `src/services/water-network-gis-be/WaterNetwork.Gis.sln`, 5 src csproj, 3 test csproj, `src/services/water-network-gis-be/WaterNetwork.Gis.Api/Program.cs`, `src/services/water-network-gis-be/WaterNetwork.Gis.Api/appsettings.json`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GisApiFactory.cs`, `HealthCheckTests.cs`

- [ ] **Step 1: Tạo solution + projects + references**

```bash
cd services/water-network-gis-be
dotnet new sln -n WaterNetwork.Gis
dotnet new web -o src/WaterNetwork.Gis.Api
dotnet new classlib -o src/WaterNetwork.Gis.Application
dotnet new classlib -o src/WaterNetwork.Gis.Domain
dotnet new classlib -o src/WaterNetwork.Gis.Infrastructure
dotnet new classlib -o src/WaterNetwork.Gis.Contracts
dotnet new xunit -o tests/WaterNetwork.Gis.UnitTests
dotnet new xunit -o tests/WaterNetwork.Gis.IntegrationTests
dotnet new xunit -o tests/WaterNetwork.Gis.ContractTests
dotnet sln add src/**/ tests/**/
# Xóa Class1.cs mặc định
rm -f src/*/Class1.cs tests/*/UnitTest1.cs
```

Layer references (spec §3.3):

```bash
BB=../../building-blocks
dotnet add src/WaterNetwork.Gis.Domain reference $BB/WaterPlatform.BuildingBlocks.Domain
dotnet add src/WaterNetwork.Gis.Application reference src/WaterNetwork.Gis.Domain src/WaterNetwork.Gis.Contracts $BB/WaterPlatform.BuildingBlocks.Application $BB/WaterPlatform.BuildingBlocks.MultiTenancy
dotnet add src/WaterNetwork.Gis.Infrastructure reference src/WaterNetwork.Gis.Application src/WaterNetwork.Gis.Domain $BB/WaterPlatform.BuildingBlocks.Infrastructure $BB/WaterPlatform.BuildingBlocks.EventBus
dotnet add src/WaterNetwork.Gis.Api reference src/WaterNetwork.Gis.Application src/WaterNetwork.Gis.Infrastructure src/WaterNetwork.Gis.Contracts $BB/WaterPlatform.BuildingBlocks.WebApi
dotnet add tests/WaterNetwork.Gis.UnitTests reference src/WaterNetwork.Gis.Domain src/WaterNetwork.Gis.Application
dotnet add tests/WaterNetwork.Gis.IntegrationTests reference src/WaterNetwork.Gis.Api $BB/WaterPlatform.BuildingBlocks.Testing $BB/WaterPlatform.BuildingBlocks.Security
dotnet add tests/WaterNetwork.Gis.ContractTests reference src/WaterNetwork.Gis.Contracts src/WaterNetwork.Gis.Infrastructure
```

Packages: Infrastructure cần `Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite`, `Microsoft.EntityFrameworkCore.Design`, `Dapper`; Application cần `FluentValidation`; IntegrationTests cần `Microsoft.AspNetCore.Mvc.Testing`, `FluentAssertions`; UnitTests cần `FluentAssertions`, `NSubstitute`.

```bash
dotnet add src/WaterNetwork.Gis.Infrastructure package Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite
dotnet add src/WaterNetwork.Gis.Infrastructure package Microsoft.EntityFrameworkCore.Design
dotnet add src/WaterNetwork.Gis.Infrastructure package Dapper
dotnet add src/WaterNetwork.Gis.Application package FluentValidation
dotnet add tests/WaterNetwork.Gis.IntegrationTests package Microsoft.AspNetCore.Mvc.Testing
dotnet add tests/WaterNetwork.Gis.IntegrationTests package FluentAssertions
dotnet add tests/WaterNetwork.Gis.UnitTests package FluentAssertions
dotnet add tests/WaterNetwork.Gis.UnitTests package NSubstitute
dotnet add tests/WaterNetwork.Gis.ContractTests package FluentAssertions
```

- [ ] **Step 2: `src/services/water-network-gis-be/WaterNetwork.Gis.Api/appsettings.json`**

```json
{
  "ServiceName": "water-network-gis-be",
  "ConnectionStrings": {
    "PostgreSQL": "Host=localhost;Port=5432;Database=wn_gis;Username=postgres;Password=postgres",
    "Redis": ""
  },
  "EventBus": { "Producer": "water-network-gis-be", "Transport": "RabbitMq" },
  "MassTransit": { "RabbitMq": { "Host": "localhost", "Username": "guest", "Password": "guest" } },
  "MultiTenancy": { "AllowHeaderFallback": true },
  "Jwt": { "Mode": "Mock" },
  "Outbox": { "BatchSize": 20, "MaxRetries": 5, "PollingIntervalSeconds": 5 },
  "Database": { "ApplyMigrationsOnStartup": false },
  "Serilog": { "MinimumLevel": { "Default": "Information" } }
}
```

- [ ] **Step 3: `src/services/water-network-gis-be/WaterNetwork.Gis.Api/Program.cs`** (phiên bản scaffold — module Gis thêm dần ở Task 12–15)

```csharp
using WaterPlatform.BuildingBlocks.Application;
using WaterPlatform.BuildingBlocks.EventBus;
using WaterPlatform.BuildingBlocks.Infrastructure;
using WaterPlatform.BuildingBlocks.WebApi.Bootstrap;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterNetwork.Gis.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddPlatformCqrs();
builder.Services.AddPlatformCqrsBehaviors();
builder.Services.AddPlatformPersistence<GisDbContext>(builder.Configuration, o => o.UseNetTopologySuite());
builder.Services.AddPlatformOutbox(builder.Configuration);
builder.Services.AddPlatformRedisCache(builder.Configuration);
builder.Services.AddPlatformEventBus(builder.Configuration);
builder.Services.AddPlatformWebApi(builder.Configuration);
builder.Services.AddHealthChecks();

var app = builder.Build();

app.UsePlatformWebApi();
app.MapHealthChecks("/health");
app.MapEndpointModules(typeof(Program).Assembly);

app.Run();

public partial class Program;
```

Tạo placeholder `src/services/water-network-gis-be/WaterNetwork.Gis.Infrastructure/Persistence/GisDbContext.cs` tối thiểu để build (mở rộng ở Task 13):

```csharp
using Microsoft.EntityFrameworkCore;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class GisDbContext(DbContextOptions<GisDbContext> options) : PlatformDbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(GisDbContext).Assembly);
    }
}
```

- [ ] **Step 4: Integration test factory + health test**

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GisApiFactory.cs`:

```csharp
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Gis.IntegrationTests;

public sealed class GisApiFactory(PostgisFixture postgis) : WebApplicationFactory<Program>
{
    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:PostgreSQL"] = postgis.ConnectionString,
            ["ConnectionStrings:Redis"] = "",
            ["EventBus:Transport"] = "InMemory",
            ["Database:ApplyMigrationsOnStartup"] = "true"
        }));
        return base.CreateHost(builder);
    }
}
```

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/HealthCheckTests.cs`:

```csharp
using System.Net;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class HealthCheckTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task Health_Returns_200()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
```

Lưu ý: migration startup (`Database:ApplyMigrationsOnStartup=true`) cần `DatabaseMigrationExtensions` (đã copy ở Task 4). Nếu extension đó yêu cầu gọi trong Program.cs, thêm `app.ApplyDatabaseMigrations();` (đối chiếu chữ ký file đã copy) vào Program.cs sau `var app = builder.Build();`. Khi chưa có migration (Task 13 mới tạo), `MigrateAsync` trên context không migration vẫn chạy OK.

- [ ] **Step 5: Run health test**

Run: `dotnet test tests/WaterNetwork.Gis.IntegrationTests --filter HealthCheckTests` (cần Docker đang chạy)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/water-network-gis-be
git commit -m "feat(gis): scaffold water-network-gis-be solution with platform building blocks and health check"
```

---

### Task 11: GIS Domain — GeoPoint, AssetCode, NodeType, NetworkNode (TDD)

**Files:**
- Create: `src/services/water-network-gis-be/WaterNetwork.Gis.Domain/ValueObjects/GeoPoint.cs`, `ValueObjects/AssetCode.cs`, `ValueObjects/NodeType.cs`, `DomainEvents/NodeRegistered.cs`, `Aggregates/NetworkNode.cs`, `Repositories/INetworkNodeRepository.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Domain/GeoPointTests.cs`, `AssetCodeTests.cs`, `NetworkNodeTests.cs`

Mọi lệnh trong Task 11–15 chạy từ `src/services/water-network-gis-be/`.

- [ ] **Step 1: Viết failing tests**

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Domain/GeoPointTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class GeoPointTests
{
    [Fact]
    public void Creates_Valid_Point()
    {
        var point = new GeoPoint(10.762622, 106.660172);
        point.Latitude.Should().Be(10.762622);
        point.Longitude.Should().Be(106.660172);
    }

    [Theory]
    [InlineData(-90.01)]
    [InlineData(90.01)]
    public void Rejects_Invalid_Latitude(double lat)
    {
        var act = () => new GeoPoint(lat, 106.0);
        act.Should().Throw<DomainException>();
    }

    [Theory]
    [InlineData(-180.01)]
    [InlineData(180.01)]
    public void Rejects_Invalid_Longitude(double lng)
    {
        var act = () => new GeoPoint(10.0, lng);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Equality_By_Value()
    {
        new GeoPoint(10, 106).Should().Be(new GeoPoint(10, 106));
    }
}
```

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Domain/AssetCodeTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class AssetCodeTests
{
    [Theory]
    [InlineData("ND-001")]
    [InlineData("node_01")]
    public void Accepts_Valid_Code(string code)
    {
        new AssetCode(code).Value.Should().Be(code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("có dấu cách")]
    public void Rejects_Invalid_Code(string code)
    {
        var act = () => new AssetCode(code);
        act.Should().Throw<DomainException>();
    }

    [Fact]
    public void Rejects_Code_Longer_Than_64()
    {
        var act = () => new AssetCode(new string('a', 65));
        act.Should().Throw<DomainException>();
    }
}
```

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Domain/NetworkNodeTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class NetworkNodeTests
{
    [Fact]
    public void Register_Creates_Node_With_NodeRegistered_Event()
    {
        var node = NetworkNode.Register(
            tenantId: "tenant-001",
            assetCode: new AssetCode("ND-001"),
            nodeType: NodeType.Junction,
            location: new GeoPoint(10.762622, 106.660172));

        node.Id.Should().StartWith("node-");
        node.TenantId.Should().Be("tenant-001");
        node.AssetCode.Value.Should().Be("ND-001");
        node.NodeType.Should().Be(NodeType.Junction);
        node.Location.Should().Be(new GeoPoint(10.762622, 106.660172));

        var evt = node.GetDomainEvents().OfType<NodeRegistered>().Single();
        evt.AggregateId.Should().Be(node.Id);
        evt.EventType.Should().Be("NodeRegistered");
        evt.Data.AssetCode.Should().Be("ND-001");
        evt.Data.TenantId.Should().Be("tenant-001");
        evt.Data.Latitude.Should().Be(10.762622);
        evt.Data.Longitude.Should().Be(106.660172);
    }

    [Fact]
    public void Reconstitute_Does_Not_Emit_Events()
    {
        var node = NetworkNode.Reconstitute(
            "node-x", "tenant-001", new AssetCode("ND-001"), NodeType.Junction,
            new GeoPoint(10, 106), version: 3, createdAt: DateTime.UtcNow, updatedAt: DateTime.UtcNow);

        node.GetDomainEvents().Should().BeEmpty();
        node.Version.Should().Be(3);
    }
}
```

- [ ] **Step 2: Run tests, xác nhận FAIL (compile error)**

Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`
Expected: FAIL

- [ ] **Step 3: Implement Domain**

`src/services/water-network-gis-be/WaterNetwork.Gis.Domain/ValueObjects/GeoPoint.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed class GeoPoint : ValueObject
{
    public const int Srid = 4326;

    public double Latitude { get; }
    public double Longitude { get; }

    public GeoPoint(double latitude, double longitude)
    {
        if (latitude is < -90 or > 90)
            throw new DomainException($"Latitude {latitude} must be between -90 and 90.");
        if (longitude is < -180 or > 180)
            throw new DomainException($"Longitude {longitude} must be between -180 and 180.");
        Latitude = latitude;
        Longitude = longitude;
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Latitude;
        yield return Longitude;
    }
}
```

(Đối chiếu base `ValueObject` đã copy: nếu method abstract tên khác — ví dụ `GetAtomicValues` — dùng đúng tên đó. `DomainException` ctor: đối chiếu file `Exceptions/DomainException.cs` đã copy; nếu ctor yêu cầu error code, dùng `new DomainException("GIS_INVALID_LOCATION", message)` theo đúng chữ ký.)

`src/services/water-network-gis-be/WaterNetwork.Gis.Domain/ValueObjects/AssetCode.cs`:

```csharp
using System.Text.RegularExpressions;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed partial class AssetCode : ValueObject
{
    public string Value { get; }

    public AssetCode(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 64 || !CodePattern().IsMatch(value))
            throw new DomainException($"Asset code '{value}' is invalid. Expected 1-64 chars of [A-Za-z0-9_-].");
        Value = value;
    }

    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex CodePattern();

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Value;
    }

    public override string ToString() => Value;
}
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Domain/ValueObjects/NodeType.cs`:

```csharp
namespace WaterNetwork.Gis.Domain.ValueObjects;

public enum NodeType
{
    Junction,
    Reservoir,
    Tank,
    Hydrant,
    Other
}
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Domain/DomainEvents/NodeRegistered.cs` (dùng `DomainEventBase<TData>` đã copy từ SAMPLE — đối chiếu chữ ký ctor trong `src/building-blocks/.../Events/DomainEventBase.cs`, mẫu SAMPLE: `DomainEventBase<string>(AggregateId, "Test", "TestEvent", "test-data")` tức `(aggregateId, aggregateType, eventType, data)`):

```csharp
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record NodeRegisteredData(
    string TenantId, string AssetCode, string NodeType, double Latitude, double Longitude);

public sealed record NodeRegistered(string AggregateId, NodeRegisteredData EventData)
    : DomainEventBase<NodeRegisteredData>(AggregateId, "NetworkNode", "NodeRegistered", EventData);
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Domain/Aggregates/NetworkNode.cs`:

```csharp
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Gis.Domain.Aggregates;

public sealed class NetworkNode : AggregateRoot
{
    public string TenantId { get; private set; }
    public AssetCode AssetCode { get; private set; }
    public NodeType NodeType { get; private set; }
    public GeoPoint Location { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    private NetworkNode(
        string id, string tenantId, AssetCode assetCode, NodeType nodeType, GeoPoint location,
        int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        TenantId = tenantId;
        AssetCode = assetCode;
        NodeType = nodeType;
        Location = location;
    }

    public static NetworkNode Register(string tenantId, AssetCode assetCode, NodeType nodeType, GeoPoint location)
    {
        var node = new NetworkNode($"node-{Guid.NewGuid():N}", tenantId, assetCode, nodeType, location);
        node.AddDomainEvent(new NodeRegistered(
            node.Id,
            new NodeRegisteredData(tenantId, assetCode.Value, nodeType.ToString(), location.Latitude, location.Longitude)));
        return node;
    }

    public static NetworkNode Reconstitute(
        string id, string tenantId, AssetCode assetCode, NodeType nodeType, GeoPoint location,
        int version, DateTime createdAt, DateTime updatedAt, DateTime? deletedAt = null)
        => new(id, tenantId, assetCode, nodeType, location, version, createdAt, updatedAt) { DeletedAt = deletedAt };
}
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Domain/Repositories/INetworkNodeRepository.cs`:

```csharp
using WaterNetwork.Gis.Domain.Aggregates;

namespace WaterNetwork.Gis.Domain.Repositories;

public interface INetworkNodeRepository
{
    Task<NetworkNode> SaveAsync(NetworkNode node, CancellationToken ct = default);
    Task<NetworkNode?> GetByIdAsync(string id, CancellationToken ct = default);
    Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default);
}
```

- [ ] **Step 4: Run tests, xác nhận PASS**

Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add services/water-network-gis-be
git commit -m "feat(gis): NetworkNode aggregate with GeoPoint/AssetCode value objects and NodeRegistered event"
```

---

### Task 12: GIS Application — RegisterNodeCommand + GetNodeDetailQuery (TDD)

**Files:**
- Create: `src/services/water-network-gis-be/WaterNetwork.Gis.Application/Commands/RegisterNodeCommand.cs`, `Commands/RegisterNodeCommandHandler.cs`, `Validators/RegisterNodeCommandValidator.cs`, `Queries/GetNodeDetailQuery.cs`, `Queries/GetNodeDetailQueryHandler.cs`, `Ports/INodeReadDao.cs`, `Dtos/NodeDetailDto.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/RegisterNodeCommandHandlerTests.cs`, `RegisterNodeCommandValidatorTests.cs`

- [ ] **Step 1: Viết failing tests**

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/RegisterNodeCommandHandlerTests.cs`:

```csharp
using FluentAssertions;
using NSubstitute;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RegisterNodeCommandHandlerTests
{
    private readonly INetworkNodeRepository _repository = Substitute.For<INetworkNodeRepository>();
    private readonly ITenantContextAccessor _tenantAccessor = Substitute.For<ITenantContextAccessor>();

    private RegisterNodeCommandHandler CreateHandler()
    {
        _tenantAccessor.Current.Returns(new TenantContext("tenant-001"));
        _repository.SaveAsync(Arg.Any<NetworkNode>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<NetworkNode>());
        return new RegisterNodeCommandHandler(_repository, _tenantAccessor);
    }

    [Fact]
    public async Task Handle_Registers_Node_And_Returns_Id()
    {
        _repository.ExistsByAssetCodeAsync("tenant-001", "ND-001", Arg.Any<CancellationToken>()).Returns(false);
        var handler = CreateHandler();

        var id = await handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.762622, 106.660172), CancellationToken.None);

        id.Should().StartWith("node-");
        await _repository.Received(1).SaveAsync(
            Arg.Is<NetworkNode>(n => n.AssetCode.Value == "ND-001" && n.TenantId == "tenant-001"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_Throws_Conflict_When_AssetCode_Exists()
    {
        _repository.ExistsByAssetCodeAsync("tenant-001", "ND-001", Arg.Any<CancellationToken>()).Returns(true);
        var handler = CreateHandler();

        var act = () => handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.7, 106.6), CancellationToken.None);

        await act.Should().ThrowAsync<ConflictException>();
    }

    [Fact]
    public async Task Handle_Throws_When_Tenant_Missing()
    {
        _tenantAccessor.Current.Returns((TenantContext?)null);
        var handler = new RegisterNodeCommandHandler(_repository, _tenantAccessor);

        var act = () => handler.HandleAsync(
            new RegisterNodeCommand("ND-001", "Junction", 10.7, 106.6), CancellationToken.None);

        await act.Should().ThrowAsync<UnauthorizedException>();
    }
}
```

(`ConflictException`/`UnauthorizedException` từ `WaterPlatform.BuildingBlocks.Domain.Exceptions` — đối chiếu ctor file đã copy, truyền message/code theo đúng chữ ký.)

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/RegisterNodeCommandValidatorTests.cs`:

```csharp
using FluentAssertions;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Validators;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Application;

public class RegisterNodeCommandValidatorTests
{
    private readonly RegisterNodeCommandValidator _validator = new();

    [Fact]
    public void Valid_Command_Passes()
    {
        var result = _validator.Validate(new RegisterNodeCommand("ND-001", "Junction", 10.76, 106.66));
        result.IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData("", "Junction", 10, 106)]       // thiếu assetCode
    [InlineData("ND-001", "NotAType", 10, 106)] // nodeType sai
    [InlineData("ND-001", "Junction", 95, 106)] // lat ngoài khoảng
    [InlineData("ND-001", "Junction", 10, 200)] // lng ngoài khoảng
    public void Invalid_Command_Fails(string assetCode, string nodeType, double lat, double lng)
    {
        var result = _validator.Validate(new RegisterNodeCommand(assetCode, nodeType, lat, lng));
        result.IsValid.Should().BeFalse();
    }
}
```

- [ ] **Step 2: Run, xác nhận FAIL**

Run: `dotnet test tests/WaterNetwork.Gis.UnitTests --filter "FullyQualifiedName~Application"`
Expected: FAIL (compile)

- [ ] **Step 3: Implement**

`src/services/water-network-gis-be/WaterNetwork.Gis.Application/Commands/RegisterNodeCommand.cs`:

```csharp
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RegisterNodeCommand(
    string AssetCode, string NodeType, double Latitude, double Longitude) : ICommand<string>;
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Application/Commands/RegisterNodeCommandHandler.cs`:

```csharp
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RegisterNodeCommandHandler(
    INetworkNodeRepository repository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<RegisterNodeCommand, string>
{
    public async Task<string> HandleAsync(RegisterNodeCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw new UnauthorizedException("Tenant context is required to register a node.");

        if (await repository.ExistsByAssetCodeAsync(tenant.TenantId, command.AssetCode, ct))
        {
            throw new ConflictException($"Asset code '{command.AssetCode}' already exists in tenant '{tenant.TenantId}'.");
        }

        var node = NetworkNode.Register(
            tenant.TenantId,
            new AssetCode(command.AssetCode),
            Enum.Parse<NodeType>(command.NodeType, ignoreCase: true),
            new GeoPoint(command.Latitude, command.Longitude));

        await repository.SaveAsync(node, ct);
        return node.Id;
    }
}
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Application/Validators/RegisterNodeCommandValidator.cs`:

```csharp
using FluentValidation;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Domain.ValueObjects;

namespace WaterNetwork.Gis.Application.Validators;

public sealed class RegisterNodeCommandValidator : AbstractValidator<RegisterNodeCommand>
{
    public RegisterNodeCommandValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.NodeType).NotEmpty()
            .Must(v => Enum.TryParse<NodeType>(v, ignoreCase: true, out _))
            .WithMessage("NodeType must be one of: Junction, Reservoir, Tank, Hydrant, Other.");
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90);
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180);
    }
}
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Application/Dtos/NodeDetailDto.cs`:

```csharp
namespace WaterNetwork.Gis.Application.Dtos;

public sealed record NodeDetailDto(
    string Id, string AssetCode, string NodeType,
    double Latitude, double Longitude, int Version, DateTime CreatedAt, DateTime UpdatedAt);
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Application/Ports/INodeReadDao.cs`:

```csharp
using WaterNetwork.Gis.Application.Dtos;

namespace WaterNetwork.Gis.Application.Ports;

public interface INodeReadDao
{
    Task<NodeDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
}
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Application/Queries/GetNodeDetailQuery.cs` + `GetNodeDetailQueryHandler.cs`:

```csharp
using WaterNetwork.Gis.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Gis.Application.Queries;

public sealed record GetNodeDetailQuery(string NodeId) : IQuery<NodeDetailDto?>;
```

```csharp
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Queries;

public sealed class GetNodeDetailQueryHandler(
    INodeReadDao readDao,
    ITenantContextAccessor tenantAccessor) : IQueryHandler<GetNodeDetailQuery, NodeDetailDto?>
{
    public Task<NodeDetailDto?> HandleAsync(GetNodeDetailQuery query, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw new UnauthorizedException("Tenant context is required.");
        return readDao.GetByIdAsync(tenant.TenantId, query.NodeId, ct);
    }
}
```

- [ ] **Step 4: Run tests, PASS**

Run: `dotnet test tests/WaterNetwork.Gis.UnitTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/water-network-gis-be
git commit -m "feat(gis): RegisterNode command and GetNodeDetail query with validation"
```

---

### Task 13: GIS Infrastructure — PostGIS persistence + migration + integration tests

**Files:**
- Create: `src/services/water-network-gis-be/WaterNetwork.Gis.Infrastructure/Persistence/NetworkNodePersistenceModel.cs`, `Persistence/Configurations/NetworkNodeConfiguration.cs`, `Persistence/DesignTimeGisDbContextFactory.cs`, `Repositories/NetworkNodeRepository.cs`, `Repositories/NodeReadDao.cs`
- Modify: `src/services/water-network-gis-be/WaterNetwork.Gis.Infrastructure/Persistence/GisDbContext.cs` (thêm DbSet)
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/NetworkNodeRepositoryTests.cs`

- [ ] **Step 1: Persistence model + configuration**

`Persistence/NetworkNodePersistenceModel.cs`:

```csharp
using NetTopologySuite.Geometries;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class NetworkNodePersistenceModel
{
    public string Id { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string AssetCode { get; set; } = default!;
    public string NodeType { get; set; } = default!;
    public Point Location { get; set; } = default!;
    public int Version { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}
```

`Persistence/Configurations/NetworkNodeConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class NetworkNodeConfiguration : IEntityTypeConfiguration<NetworkNodePersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkNodePersistenceModel> builder)
    {
        builder.ToTable("network_nodes");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.NodeType).HasColumnName("node_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.Location).HasColumnName("location").HasColumnType("geometry(Point,4326)").IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");

        builder.HasIndex(x => new { x.TenantId, x.AssetCode }).IsUnique().HasDatabaseName("ux_network_nodes_tenant_asset_code");
        builder.HasIndex(x => x.Location).HasMethod("gist").HasDatabaseName("ix_network_nodes_location_gist");
        builder.HasQueryFilter(x => x.DeletedAt == null);
    }
}
```

- [ ] **Step 2: GisDbContext + design-time factory**

Cập nhật `Persistence/GisDbContext.cs` thêm: `public DbSet<NetworkNodePersistenceModel> NetworkNodes => Set<NetworkNodePersistenceModel>();`

`Persistence/DesignTimeGisDbContextFactory.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class DesignTimeGisDbContextFactory : IDesignTimeDbContextFactory<GisDbContext>
{
    public GisDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<GisDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=wn_gis;Username=postgres;Password=postgres",
                o => o.UseNetTopologySuite())
            .Options;
        return new GisDbContext(options);
    }
}
```

- [ ] **Step 3: Repository + ReadDao**

`Repositories/NetworkNodeRepository.cs` (kế thừa `AggregateRepositoryBase` đã copy — outbox tự ghi trong SaveAsync):

```csharp
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class NetworkNodeRepository(
    GisDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkNode>(eventDispatcher, outboxRepository), INetworkNodeRepository
{
    public override async Task<NetworkNode?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkNodes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return model is null ? null : ToDomain(model);
    }

    public async Task<bool> ExistsByAssetCodeAsync(string tenantId, string assetCode, CancellationToken ct = default)
        => await dbContext.NetworkNodes.AnyAsync(x => x.TenantId == tenantId && x.AssetCode == assetCode, ct);

    public override async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkNodes.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (model is null) return;
        model.DeletedAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(ct);
    }

    protected override async Task PersistAsync(NetworkNode aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.NetworkNodes.FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);
        if (existing is null)
        {
            dbContext.NetworkNodes.Add(ToModel(aggregate));
        }
        else
        {
            existing.AssetCode = aggregate.AssetCode.Value;
            existing.NodeType = aggregate.NodeType.ToString();
            existing.Location = ToPoint(aggregate.Location);
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;
            existing.DeletedAt = aggregate.DeletedAt;
        }
        await dbContext.SaveChangesAsync(ct);
    }

    private static Point ToPoint(GeoPoint p) => new(p.Longitude, p.Latitude) { SRID = GeoPoint.Srid };

    private static NetworkNodePersistenceModel ToModel(NetworkNode node) => new()
    {
        Id = node.Id,
        TenantId = node.TenantId,
        AssetCode = node.AssetCode.Value,
        NodeType = node.NodeType.ToString(),
        Location = ToPoint(node.Location),
        Version = node.Version,
        CreatedAt = node.CreatedAt,
        UpdatedAt = node.UpdatedAt,
        DeletedAt = node.DeletedAt
    };

    private static NetworkNode ToDomain(NetworkNodePersistenceModel model)
        => NetworkNode.Reconstitute(
            model.Id, model.TenantId, new AssetCode(model.AssetCode),
            Enum.Parse<NodeType>(model.NodeType), new GeoPoint(model.Location.Y, model.Location.X),
            model.Version, model.CreatedAt, model.UpdatedAt, model.DeletedAt);
}
```

(Đối chiếu `AggregateRepositoryBase` đã copy: nếu `Entity` base không có setter `CreatedAt/UpdatedAt` public — dùng giá trị từ aggregate như trên. Nếu `IAggregateRepository` bắt buộc thêm method — implement theo interface copy.)

`Repositories/NodeReadDao.cs` (Dapper, read-side):

```csharp
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class NodeReadDao(GisDbContext dbContext) : INodeReadDao
{
    public async Task<NodeDetailDto?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        const string sql = """
            SELECT id, asset_code AS AssetCode, node_type AS NodeType,
                   ST_Y(location) AS Latitude, ST_X(location) AS Longitude,
                   version, created_at AS CreatedAt, updated_at AS UpdatedAt
            FROM network_nodes
            WHERE id = @id AND tenant_id = @tenantId AND deleted_at IS NULL
            """;
        var connection = dbContext.Database.GetDbConnection();
        return await connection.QuerySingleOrDefaultAsync<NodeDetailDto>(
            new CommandDefinition(sql, new { id, tenantId }, cancellationToken: ct));
    }
}
```

- [ ] **Step 4: Tạo migration**

```bash
dotnet ef migrations add InitialCreate \
  --project src/WaterNetwork.Gis.Infrastructure \
  --startup-project src/WaterNetwork.Gis.Api \
  --output-dir Persistence/Migrations
```

(Nếu `dotnet ef` chưa cài: `dotnet tool install --global dotnet-ef`.) Kiểm tra file migration sinh ra có: bảng `network_nodes` với cột `location geometry(Point,4326)`, unique index `(tenant_id, asset_code)`, GiST index, và các bảng platform (outbox/idempotency/processed events). Nếu thiếu PostGIS extension trong migration, thêm vào đầu `Up()`: `migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS postgis;");`

- [ ] **Step 5: Integration test repository + outbox (Testcontainers)**

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/NetworkNodeRepositoryTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class NetworkNodeRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task Save_Then_Get_Roundtrip_And_Outbox_Row_Created()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var node = NetworkNode.Register(
            "tenant-001", new AssetCode($"ND-{Guid.NewGuid():N}"[..16]), NodeType.Junction,
            new GeoPoint(10.762622, 106.660172));

        await repository.SaveAsync(node);

        var loaded = await repository.GetByIdAsync(node.Id);
        loaded.Should().NotBeNull();
        loaded!.AssetCode.Should().Be(node.AssetCode);
        loaded.Location.Latitude.Should().BeApproximately(10.762622, 1e-9);

        dbContext.OutboxEntries.Count(e => e.EventType == "NodeRegistered").Should().BeGreaterThan(0);
    }
}
```

(Nếu `OutboxEntry` không có property `EventType` — đối chiếu file copy `Outbox/OutboxEntry.cs` và dùng đúng tên property.)

- [ ] **Step 6: Đăng ký DI module Gis trong Program.cs**

Thêm vào `Program.cs` trước `var app = builder.Build();`:

```csharp
builder.Services.AddHandlersFromAssembly(typeof(WaterNetwork.Gis.Application.Commands.RegisterNodeCommand).Assembly);
builder.Services.AddScoped<WaterNetwork.Gis.Domain.Repositories.INetworkNodeRepository,
    WaterNetwork.Gis.Infrastructure.Repositories.NetworkNodeRepository>();
builder.Services.AddScoped<WaterNetwork.Gis.Application.Ports.INodeReadDao,
    WaterNetwork.Gis.Infrastructure.Repositories.NodeReadDao>();
builder.Services.AddValidatorsFromAssembly(typeof(WaterNetwork.Gis.Application.Validators.RegisterNodeCommandValidator).Assembly);
```

(`AddValidatorsFromAssembly` cần `using FluentValidation;` và package `FluentValidation.DependencyInjectionExtensions` trong Api.)

- [ ] **Step 7: Run integration tests + commit**

Run: `dotnet test tests/WaterNetwork.Gis.IntegrationTests`
Expected: PASS (health + repository tests)

```bash
git add services/water-network-gis-be
git commit -m "feat(gis): PostGIS persistence for network nodes with outbox integration"
```

---

### Task 14: GIS Contracts + integration event `network.node.registered` v1

**Files:**
- Create: `src/services/water-network-gis-be/WaterNetwork.Gis.Contracts/Events/GisEventTypes.cs`, `Events/NetworkNodeRegisteredV1.cs`
- Create: `src/services/water-network-gis-be/WaterNetwork.Gis.Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/NetworkNodeRegisteredContractTests.cs`

- [ ] **Step 1: Contracts (KHÔNG phụ thuộc Infrastructure — chỉ POCO)**

`src/services/water-network-gis-be/WaterNetwork.Gis.Contracts/Events/GisEventTypes.cs`:

```csharp
namespace WaterNetwork.Gis.Contracts.Events;

public static class GisEventTypes
{
    public const string NodeRegistered = "network.node.registered";
}
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Contracts/Events/NetworkNodeRegisteredV1.cs`:

```csharp
namespace WaterNetwork.Gis.Contracts.Events;

public sealed record NetworkNodeRegisteredV1(
    string NodeId,
    string TenantId,
    string AssetCode,
    string NodeType,
    double Latitude,
    double Longitude);
```

- [ ] **Step 2: Mapper domain event → integration event**

`src/services/water-network-gis-be/WaterNetwork.Gis.Infrastructure/IntegrationEvents/GisIntegrationEventMapper.cs` — implement `IIntegrationEventMapper` (interface copy: `IIntegrationEvent? Map(IDomainEvent)`, `bool CanMap(string eventType)`). Cần một implementation `IIntegrationEvent` cụ thể; đối chiếu `IntegrationEventBase` đã copy ở Task 6 và kế thừa nó. Nếu `IntegrationEventBase` không khớp, tạo record local:

```csharp
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Gis.Infrastructure.IntegrationEvents;

public sealed record NodeRegisteredIntegrationEvent(
    string EventId,
    DateTime OccurredAt,
    string SourceAggregateId,
    NetworkNodeRegisteredV1 Data) : IIntegrationEvent<NetworkNodeRegisteredV1>
{
    public string EventType => GisEventTypes.NodeRegistered;
    public int EventVersion => 1;
    public string SourceAggregateType => "NetworkNode";
}

public sealed class GisIntegrationEventMapper : IIntegrationEventMapper
{
    public bool CanMap(string eventType) => eventType == "NodeRegistered";

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
    {
        if (domainEvent is not NodeRegistered nodeRegistered) return null;
        var d = nodeRegistered.Data;
        return new NodeRegisteredIntegrationEvent(
            EventId: nodeRegistered.EventId,
            OccurredAt: nodeRegistered.OccurredAt,
            SourceAggregateId: nodeRegistered.AggregateId,
            Data: new NetworkNodeRegisteredV1(
                nodeRegistered.AggregateId, d.TenantId, d.AssetCode, d.NodeType, d.Latitude, d.Longitude));
    }
}
```

QUAN TRỌNG: `OutboxProcessor` deserialize outbox entry thành `OutboxDomainEvent` (xem file copy `Outbox/OutboxProcessor.cs` method `DeserializeOutboxEvent`) rồi đưa vào mapper — nghĩa là mapper nhận event đã serialize lại, KHÔNG phải instance `NodeRegistered` gốc. Đối chiếu type `OutboxDomainEvent`/`ISerializedDomainEvent` đã copy: nếu mapper nhận `ISerializedDomainEvent` (có `EventType` + payload JSON), implement `Map` bằng cách deserialize payload JSON thành `NodeRegisteredData`:

```csharp
    public IIntegrationEvent? Map(IDomainEvent domainEvent)
    {
        if (domainEvent.EventType != "NodeRegistered") return null;
        if (domainEvent is not ISerializedDomainEvent serialized) return null;
        var d = System.Text.Json.JsonSerializer.Deserialize<NodeRegisteredData>(serialized.SerializedData)!;
        return new NodeRegisteredIntegrationEvent(
            domainEvent.EventId, domainEvent.OccurredAt, domainEvent.AggregateId,
            new NetworkNodeRegisteredV1(domainEvent.AggregateId, d.TenantId, d.AssetCode, d.NodeType, d.Latitude, d.Longitude));
    }
```

Chọn đúng MỘT trong hai bản `Map` trên theo type thực tế mà `OutboxProcessor.DeserializeOutboxEvent` trả về (đọc file đã copy để xác định; property `SerializedData` đổi theo tên thật trong `ISerializedDomainEvent`). Đăng ký trong Program.cs: `builder.Services.AddSingleton<IIntegrationEventMapper, GisIntegrationEventMapper>();`

- [ ] **Step 3: Contract test**

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/NetworkNodeRegisteredContractTests.cs`:

```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using Xunit;

namespace WaterNetwork.Gis.ContractTests;

public class NetworkNodeRegisteredContractTests
{
    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        var evt = new NetworkNodeRegisteredV1("node-1", "tenant-001", "ND-001", "Junction", 10.76, 106.66);
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().BeEquivalentTo("NodeId", "TenantId", "AssetCode", "NodeType", "Latitude", "Longitude");
    }

    [Fact]
    public void EventType_And_Version_Are_Fixed()
    {
        GisEventTypes.NodeRegistered.Should().Be("network.node.registered");
    }
}
```

- [ ] **Step 4: Run + commit**

Run: `dotnet test tests/WaterNetwork.Gis.ContractTests && dotnet build WaterNetwork.Gis.sln`
Expected: PASS

```bash
git add services/water-network-gis-be
git commit -m "feat(gis): network.node.registered v1 contract and integration event mapper"
```

---

### Task 15: GIS API endpoints + E2E tests

**Files:**
- Create: `src/services/water-network-gis-be/WaterNetwork.Gis.Contracts/Requests/RegisterNodeRequest.cs`, `src/services/water-network-gis-be/WaterNetwork.Gis.Api/Endpoints/NodesEndpointModule.cs`, `src/services/water-network-gis-be/WaterNetwork.Gis.Api/Validators/RegisterNodeRequestValidator.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/RegisterNodeApiTests.cs`

- [ ] **Step 1: Viết failing E2E tests**

`src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/RegisterNodeApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class RegisterNodeApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static HttpClient CreateAuthenticatedClient(GisApiFactory factory, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "test-user", tenantId: "tenant-001", permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static object ValidBody(string assetCode) => new
    {
        assetCode, nodeType = "Junction", latitude = 10.762622, longitude = 106.660172
    };

    [Fact]
    public async Task Register_Valid_Node_Returns_201_And_Get_Returns_Node()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var code = $"ND-{Guid.NewGuid():N}"[..16];
        var response = await client.PostAsJsonAsync("/api/network/nodes", ValidBody(code));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        var id = created!["id"];

        var detail = await client.GetAsync($"/api/network/nodes/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await detail.Content.ReadAsStringAsync();
        body.Should().Contain(code);
    }

    [Fact]
    public async Task Duplicate_AssetCode_Returns_409()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var code = $"ND-{Guid.NewGuid():N}"[..16];
        (await client.PostAsJsonAsync("/api/network/nodes", ValidBody(code))).StatusCode.Should().Be(HttpStatusCode.Created);
        (await client.PostAsJsonAsync("/api/network/nodes", ValidBody(code))).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Invalid_Latitude_Returns_400()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var response = await client.PostAsJsonAsync("/api/network/nodes",
            new { assetCode = "ND-INVALID", nodeType = "Junction", latitude = 95.0, longitude = 106.0 });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Missing_Token_Returns_401()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/network/nodes", ValidBody("ND-NOAUTH"));
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Missing_Permission_Returns_403()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:read"); // thiếu write

        var response = await client.PostAsJsonAsync("/api/network/nodes", ValidBody("ND-NOPERM"));
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Unknown_Node_Returns_404()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:read");

        var response = await client.GetAsync("/api/network/nodes/node-khong-ton-tai");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
```

- [ ] **Step 2: Run, xác nhận FAIL** (404 vì endpoint chưa tồn tại)

Run: `dotnet test tests/WaterNetwork.Gis.IntegrationTests --filter RegisterNodeApiTests`
Expected: FAIL

- [ ] **Step 3: Implement request + endpoint module**

`src/services/water-network-gis-be/WaterNetwork.Gis.Contracts/Requests/RegisterNodeRequest.cs`:

```csharp
namespace WaterNetwork.Gis.Contracts.Requests;

public sealed record RegisterNodeRequest(string AssetCode, string NodeType, double Latitude, double Longitude);
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Api/Validators/RegisterNodeRequestValidator.cs`:

```csharp
using FluentValidation;
using WaterNetwork.Gis.Contracts.Requests;

namespace WaterNetwork.Gis.Api.Validators;

public sealed class RegisterNodeRequestValidator : AbstractValidator<RegisterNodeRequest>
{
    public RegisterNodeRequestValidator()
    {
        RuleFor(x => x.AssetCode).NotEmpty().MaximumLength(64).Matches("^[A-Za-z0-9_-]+$");
        RuleFor(x => x.NodeType).NotEmpty();
        RuleFor(x => x.Latitude).InclusiveBetween(-90, 90);
        RuleFor(x => x.Longitude).InclusiveBetween(-180, 180);
    }
}
```

`src/services/water-network-gis-be/WaterNetwork.Gis.Api/Endpoints/NodesEndpointModule.cs`:

```csharp
using Microsoft.AspNetCore.Http.HttpResults;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Dtos;
using WaterNetwork.Gis.Application.Queries;
using WaterNetwork.Gis.Contracts.Requests;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Queries;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Validation;

namespace WaterNetwork.Gis.Api.Endpoints;

public sealed class NodesEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/network/nodes");

        group.MapPost("/", async (RegisterNodeRequest request, ICommandBus commandBus, CancellationToken ct) =>
            {
                var id = await commandBus.ExecuteAsync(
                    new RegisterNodeCommand(request.AssetCode, request.NodeType, request.Latitude, request.Longitude), ct);
                return Results.Created($"/api/network/nodes/{id}", new { id });
            })
            .WithValidation<RegisterNodeRequest>()
            .RequirePermission("network-gis:write");

        group.MapGet("/{id}", async Task<Results<Ok<NodeDetailDto>, NotFound>> (
                string id, IQueryBus queryBus, CancellationToken ct) =>
            {
                var node = await queryBus.ExecuteAsync(new GetNodeDetailQuery(id), ct);
                return node is null ? TypedResults.NotFound() : TypedResults.Ok(node);
            })
            .RequirePermission("network-gis:read");
    }
}
```

Kiểm tra `GlobalExceptionMiddleware` (copy từ SAMPLE) map `ConflictException` → 409 và `ValidationException` → 400; nếu middleware copy chưa map đủ, bổ sung case tương ứng trong middleware (file thuộc building-blocks, sửa tại đó).

- [ ] **Step 4: Run E2E tests, PASS**

Run: `dotnet test tests/WaterNetwork.Gis.IntegrationTests`
Expected: PASS — 6 API tests + repository + health

- [ ] **Step 5: Run TOÀN BỘ test suite hai solution**

```bash
dotnet test ../../WaterPlatform.BuildingBlocks.slnx
dotnet test WaterNetwork.Gis.sln
```
Expected: tất cả PASS

- [ ] **Step 6: Commit**

```bash
git add services/water-network-gis-be
git commit -m "feat(gis): register node and node detail minimal API endpoints with authz and e2e tests"
```

---

### Task 16: docker-compose service + convention mapping doc + verification cuối

**Files:**
- Modify: `docker-compose.yml` (thêm gis-be)
- Create: `src/services/water-network-gis-be/Dockerfile`, `docs/conventions/template-mapping.md`, `README.md` (cập nhật)

- [ ] **Step 1: Dockerfile** (theo mẫu SAMPLE `Dockerfile`, sửa đường dẫn)

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY building-blocks/ building-blocks/
COPY src/services/water-network-gis-be/ src/services/water-network-gis-be/
RUN dotnet publish src/services/water-network-gis-be/WaterNetwork.Gis.Api -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "WaterNetwork.Gis.Api.dll"]
```

Build context phải là repo root: trong compose dùng `build: { context: ., dockerfile: src/services/water-network-gis-be/Dockerfile }`.

- [ ] **Step 2: Thêm service vào `docker-compose.yml`**

```yaml
  water-network-gis-be:
    build:
      context: .
      dockerfile: src/services/water-network-gis-be/Dockerfile
    ports: ["8081:8080"]
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - ConnectionStrings__PostgreSQL=Host=postgres;Port=5432;Database=wn_gis;Username=postgres;Password=postgres
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

- [ ] **Step 3: Smoke test**

```bash
docker compose up -d --build
sleep 15
curl -fsS http://localhost:8081/health && echo " HEALTH-OK"
docker compose down
```
Expected: `HEALTH-OK`

- [ ] **Step 4: Viết `docs/conventions/template-mapping.md`** (spec Phase 0 AC #7 — tài liệu mapping convention)

Nội dung tối thiểu: bảng mapping SAMPLE → building blocks (như bản đồ file của plan này), quy tắc layer (spec §3.3), cách scaffold service mới (lặp Task 10), quyết định MediatR→custom dispatcher, Keycloak mock và cách bật `Jwt:Mode=Authority` sau này, danh sách mock adapters hiện có.

- [ ] **Step 5: Cập nhật `README.md`** — quickstart: `docker compose up -d`, chạy test 2 solution, link tới spec/plan/mapping doc.

- [ ] **Step 6: Verification cuối + commit**

```bash
dotnet test WaterPlatform.BuildingBlocks.slnx
cd services/water-network-gis-be && dotnet test WaterNetwork.Gis.sln && cd ../..
git add -A
git commit -m "feat: gis service container, convention mapping doc and quickstart"
```

Expected: toàn bộ tests PASS — Phase 0 AC: scaffold convention xác nhận trên 1 service mẫu (gis-be) ✔, tenant context HTTP/command/event ✔, Outbox chạy bằng integration test ✔, docker-compose đủ DB/broker/redis ✔, observability baseline ✔, Testcontainers ✔, mapping doc ✔. US-P1-01 acceptance: 201 + id ✔, duplicate → 409 ✔, invalid location → 400 ✔, SRID 4326 ✔, domain event ✔, outbox ✔, get detail ✔, tests pass ✔.

---

## Self-review checklist (đã chạy)

- **Spec coverage**: US-P0-01 (Task 2–10), US-P0-02 (Task 5, 12, 15), US-P0-03 (Task 4, 6, 13), US-P0-04 (Task 8, 10), US-P1-01/§19 (Task 11–15), Phase 0 AC #7 mapping doc (Task 16). Inbox idempotent consumer được port (Task 4, 6) nhưng test consume-side đầy đủ thuộc Sub-project 2 (asset-be) — chủ đích, ghi nhận tại đây.
- **Type consistency**: `ICommandBus.ExecuteAsync` / `IQueryBus.ExecuteAsync` giữ nguyên chữ ký SAMPLE; `ICommandHandler.HandleAsync` dùng thống nhất Task 3/11/12/15; `PlatformDbContext` dùng thống nhất Task 4/10/13.
- **Điểm phải đối chiếu file copy khi execute** (đã ghi chú inline tại chỗ): ctor các exception, tên method `ValueObject.GetEqualityComponents`, chữ ký `DomainEventBase<TData>`, property `ISerializedDomainEvent`, chữ ký `IIntegrationEventPublisher`, mapping của `GlobalExceptionMiddleware`. Đây là copy-adaptation có chủ đích, không phải placeholder.

