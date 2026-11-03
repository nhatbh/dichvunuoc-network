# BFF-1 Asset overview + map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `water-network-bff` with two read-composition endpoints — asset `overview` (GIS detail + asset lifecycle, degrade-not-block) and `map` (GIS bbox passthrough) — slice cuối Phase 1.

**Architecture:** Single ASP.NET project `WaterNetwork.Bff.Api` (no domain/DB/event-bus). Typed `HttpClient` per downstream (`IGisApiClient`, `IAssetApiClient`) with a JWT/tenant passthrough `DelegatingHandler` and a Polly v8 resilience handler (1s per-attempt timeout, no retry, circuit breaker). GIS is authoritative (404→404, down→502); asset degrades to `lifecycle:null`. Tests: xUnit unit tests for handler + clients (stub `HttpMessageHandler`), WireMock.Net integration tests for the endpoints.

**Tech Stack:** .NET 10, ASP.NET minimal APIs, `Microsoft.Extensions.Http.Resilience`, `System.Net.Http.Json`, xUnit + FluentAssertions + WireMock.Net, building blocks `WaterPlatform.BuildingBlocks.WebApi` (auth/observability/health/endpoint-modules) + `WaterPlatform.BuildingBlocks.Security` (test token).

**Spec:** `docs/superpowers/specs/2026-06-15-bff1-asset-overview-map-design.md`

---

## File Structure

```
src/services/water-network-bff/
  WaterNetwork.Bff.slnx
  Dockerfile
  src/WaterNetwork.Bff.Api/
    WaterNetwork.Bff.Api.csproj
    Program.cs                          # bootstrap + DI wiring
    appsettings.json
    Configuration/DownstreamOptions.cs  # BaseUrl per downstream
    Http/DownstreamResult.cs            # DownstreamStatus enum + DownstreamResult<T> + MapPassthrough + ResilienceConfig
    Http/AuthForwardingHandler.cs       # copies Authorization / X-Tenant-Id / correlation id
    Http/IGisApiClient.cs
    Http/GisApiClient.cs
    Http/IAssetApiClient.cs
    Http/AssetApiClient.cs              # + AssetProfile mirror record
    Contracts/OverviewResponse.cs       # OverviewResponse + LifecycleDto + SourcesDto
    Endpoints/OverviewEndpointModule.cs # GET /bff/water-network/assets/{id}/overview
    Endpoints/MapEndpointModule.cs      # GET /bff/water-network/map
  tests/WaterNetwork.Bff.UnitTests/
    WaterNetwork.Bff.UnitTests.csproj
    StubHttpMessageHandler.cs
    AuthForwardingHandlerTests.cs
    GisApiClientTests.cs
    AssetApiClientTests.cs
  tests/WaterNetwork.Bff.IntegrationTests/
    WaterNetwork.Bff.IntegrationTests.csproj
    BffApiFactory.cs
    HealthCheckTests.cs
    OverviewEndpointTests.cs
    MapEndpointTests.cs
```

Downstream contracts (verified in codebase, for reference):
- GIS detail per type: `GET /api/network/nodes/{id}`, `/pipes/{id}`, `/devices/{id}` → 200 body | 404. Perm `network-gis:read`.
- GIS bbox: `GET /api/network/assets?bbox=&types=&limit=` → 200 array (carries `lifecycleStatus`). Perm `network-gis:read`.
- Asset profile: `GET /api/assets/{id}` → 200 `AssetDetailDto{id,tenantId,assetType,assetCode,status,createdAt,updatedAt,technicalProfile,lifecycleHistory}` | 404. Perm `network-asset:read`.
- `assetId == GIS id`; type ∈ {node,pipe,device}.

---

## Task 1: Scaffold project, packages, solution, health endpoint

**Files:**
- Modify: `Directory.Packages.props`
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/WaterNetwork.Bff.Api.csproj`
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/appsettings.json`
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Program.cs`
- Create: `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj`
- Create: `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/BffApiFactory.cs`
- Create: `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/HealthCheckTests.cs`
- Create: `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj`
- Create: `src/services/water-network-bff/WaterNetwork.Bff.slnx`

- [ ] **Step 1: Add packages to central versions**

Add these two `<PackageVersion>` lines inside the existing `<ItemGroup>` in `Directory.Packages.props` (after the `Microsoft.Extensions.Http` line for grouping):

```xml
    <PackageVersion Include="Microsoft.Extensions.Http.Resilience" Version="9.10.0" />
    <PackageVersion Include="WireMock.Net" Version="1.7.4" />
```

> If `dotnet restore` later fails on either version, bump to the latest stable on nuget.org (`Microsoft.Extensions.Http.Resilience` 9.x line, `WireMock.Net` 1.7.x line) and keep the central version pinned.

- [ ] **Step 2: Create the Api csproj**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/WaterNetwork.Bff.Api.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.WebApi/WaterPlatform.BuildingBlocks.WebApi.csproj" />
  </ItemGroup>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" />
  </ItemGroup>
</Project>
```

- [ ] **Step 3: Create appsettings.json**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/appsettings.json`:

```json
{
  "ServiceName": "water-network-bff",
  "Downstream": {
    "Gis": { "BaseUrl": "http://localhost:8081" },
    "Asset": { "BaseUrl": "http://localhost:8082" }
  },
  "MultiTenancy": {
    "AllowHeaderFallback": true
  },
  "Jwt": {
    "Mode": "Mock"
  },
  "Serilog": {
    "MinimumLevel": {
      "Default": "Information"
    }
  }
}
```

- [ ] **Step 4: Create Program.cs (health-only bootstrap)**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Program.cs`. (DI for clients/endpoints is added in later tasks; this boots far enough for `/health`.)

```csharp
using WaterPlatform.BuildingBlocks.Observability;
using WaterPlatform.BuildingBlocks.WebApi.Bootstrap;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddObservability(builder.Configuration);
builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

builder.Services.AddHttpContextAccessor();

var app = builder.Build();

app.UsePlatformWebApi();
app.MapHealthChecks("/health");
app.MapEndpointModules(app.Services, typeof(Program).Assembly);

app.Run();

public partial class Program;
```

- [ ] **Step 5: Create the IntegrationTests csproj**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj`:

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
    <PackageReference Include="WireMock.Net" />
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/WaterNetwork.Bff.Api/WaterNetwork.Bff.Api.csproj" />
    <ProjectReference Include="../../../../building-blocks/src/WaterPlatform.BuildingBlocks.Security/WaterPlatform.BuildingBlocks.Security.csproj" />
  </ItemGroup>
</Project>
```

- [ ] **Step 6: Create the WebApplicationFactory with WireMock downstreams**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/BffApiFactory.cs`:

```csharp
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using WireMock.Server;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class BffApiFactory : WebApplicationFactory<Program>
{
    public WireMockServer Gis { get; } = WireMockServer.Start();
    public WireMockServer Asset { get; } = WireMockServer.Start();

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Downstream:Gis:BaseUrl"] = Gis.Url,
            ["Downstream:Asset:BaseUrl"] = Asset.Url,
            ["Jwt:Mode"] = "Mock"
        }));
        return base.CreateHost(builder);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Gis.Stop();
            Asset.Stop();
        }
        base.Dispose(disposing);
    }
}
```

- [ ] **Step 7: Write the failing health-check test**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/HealthCheckTests.cs`:

```csharp
using System.Net;
using FluentAssertions;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class HealthCheckTests
{
    [Fact]
    public async Task Health_Endpoint_Returns_200()
    {
        using var factory = new BffApiFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
```

- [ ] **Step 8: Create the UnitTests csproj**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj`:

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
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>
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
    <ProjectReference Include="../../src/WaterNetwork.Bff.Api/WaterNetwork.Bff.Api.csproj" />
  </ItemGroup>
</Project>
```

- [ ] **Step 9: Create the solution file**

Create `src/services/water-network-bff/WaterNetwork.Bff.slnx`:

```xml
<Solution>
  <Folder Name="/src/services/water-network-bff/">
    <Project Path="src/WaterNetwork.Bff.Api/WaterNetwork.Bff.Api.csproj" />
    <Folder Name="/src/services/water-network-bff/tests/">
      <Project Path="tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj" />
      <Project Path="tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj" />
    </Folder>
  </Folder>
</Solution>
```

- [ ] **Step 10: Run the health test to verify it passes**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj`
Expected: PASS (1 test). This confirms the scaffold boots with no DB/bus dependencies.

- [ ] **Step 11: Commit**

```bash
git add Directory.Packages.props src/services/water-network-bff
git commit -m "feat(bff): scaffold water-network-bff with health endpoint (BFF-1)"
```

---

## Task 2: AuthForwardingHandler (JWT + tenant passthrough)

**Files:**
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/AuthForwardingHandler.cs`
- Create: `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/StubHttpMessageHandler.cs`
- Test: `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/AuthForwardingHandlerTests.cs`

- [ ] **Step 1: Create the reusable stub inner handler**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/StubHttpMessageHandler.cs`:

```csharp
using System.Net;
using System.Net.Http;

namespace WaterNetwork.Bff.UnitTests;

/// <summary>Captures the last outgoing request and returns a canned response (or throws).</summary>
public sealed class StubHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

    public HttpRequestMessage? LastRequest { get; private set; }

    public StubHttpMessageHandler(HttpStatusCode status, string? json = null)
        => _responder = _ => new HttpResponseMessage(status)
        {
            Content = json is null ? null : new StringContent(json, System.Text.Encoding.UTF8, "application/json")
        };

    public StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responder)
        => _responder = responder;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        return Task.FromResult(_responder(request));
    }
}
```

- [ ] **Step 2: Write the failing handler test**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/AuthForwardingHandlerTests.cs`:

```csharp
using System.Net;
using System.Net.Http;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using WaterNetwork.Bff.Api.Http;

namespace WaterNetwork.Bff.UnitTests;

public sealed class AuthForwardingHandlerTests
{
    private static HttpClient BuildClient(HttpContext? context, StubHttpMessageHandler inner)
    {
        var accessor = new HttpContextAccessor { HttpContext = context };
        var handler = new AuthForwardingHandler(accessor) { InnerHandler = inner };
        return new HttpClient(handler) { BaseAddress = new Uri("http://downstream.test") };
    }

    [Fact]
    public async Task Forwards_Authorization_And_Tenant_Headers()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers.Authorization = "Bearer abc123";
        ctx.Request.Headers["X-Tenant-Id"] = "tenant-1";

        using var client = BuildClient(ctx, inner);
        await client.GetAsync("/anything");

        inner.LastRequest!.Headers.Authorization!.ToString().Should().Be("Bearer abc123");
        inner.LastRequest.Headers.GetValues("X-Tenant-Id").Should().ContainSingle().Which.Should().Be("tenant-1");
    }

    [Fact]
    public async Task Does_Nothing_When_No_HttpContext()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        using var client = BuildClient(context: null, inner);

        var act = async () => await client.GetAsync("/anything");

        await act.Should().NotThrowAsync();
        inner.LastRequest!.Headers.Authorization.Should().BeNull();
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj`
Expected: FAIL — `AuthForwardingHandler` does not exist (compile error).

- [ ] **Step 4: Implement AuthForwardingHandler**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/AuthForwardingHandler.cs`:

```csharp
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Http;

namespace WaterNetwork.Bff.Api.Http;

/// <summary>
/// Copies the inbound caller's auth + tenant + correlation context onto outbound downstream
/// requests. BFF never mints tokens — it forwards the bearer it received (JWT passthrough).
/// </summary>
public sealed class AuthForwardingHandler(IHttpContextAccessor accessor) : DelegatingHandler
{
    private static readonly string[] ForwardedHeaders = ["X-Tenant-Id", "X-Correlation-Id"];

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var ctx = accessor.HttpContext;
        if (ctx is not null)
        {
            var auth = ctx.Request.Headers.Authorization.ToString();
            if (!string.IsNullOrWhiteSpace(auth) && AuthenticationHeaderValue.TryParse(auth, out var parsed))
                request.Headers.Authorization = parsed;

            foreach (var name in ForwardedHeaders)
            {
                var value = ctx.Request.Headers[name].ToString();
                if (!string.IsNullOrWhiteSpace(value))
                {
                    request.Headers.Remove(name);
                    request.Headers.TryAddWithoutValidation(name, value);
                }
            }
        }

        return base.SendAsync(request, cancellationToken);
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-bff
git commit -m "feat(bff): auth + tenant forwarding delegating handler (BFF-1)"
```

---

## Task 3: Downstream result types + GIS/Asset typed clients

**Files:**
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/DownstreamResult.cs`
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/IGisApiClient.cs`
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/GisApiClient.cs`
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/IAssetApiClient.cs`
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/AssetApiClient.cs`
- Test: `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/GisApiClientTests.cs`
- Test: `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/AssetApiClientTests.cs`

- [ ] **Step 1: Create the result types + resilience config (no test yet — supporting types)**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/DownstreamResult.cs`:

```csharp
using System.Text.Json.Nodes;
using Microsoft.Extensions.Http.Resilience;

namespace WaterNetwork.Bff.Api.Http;

public enum DownstreamStatus { Ok, NotFound, Unavailable }

/// <summary>Tri-state outcome of a downstream read: success+value, an explicit 404, or any failure.</summary>
public sealed record DownstreamResult<T>(DownstreamStatus Status, T? Value)
{
    public static DownstreamResult<T> Ok(T value) => new(DownstreamStatus.Ok, value);
    public static readonly DownstreamResult<T> NotFound = new(DownstreamStatus.NotFound, default);
    public static readonly DownstreamResult<T> Unavailable = new(DownstreamStatus.Unavailable, default);
}

/// <summary>Passthrough outcome for the map endpoint: forward status+body verbatim, or 502 when unavailable.</summary>
public sealed record MapPassthrough(bool Unavailable, int StatusCode, JsonNode? Body);

/// <summary>Shared Polly v8 resilience policy for downstream read clients: fail-fast, no retry.</summary>
public static class ResilienceConfig
{
    public static void Configure(HttpStandardResilienceOptions o)
    {
        // reads: do not retry, fail fast. MaxRetryAttempts=0 is rejected by the
        // options validator (min 1), so keep the minimum and make the retry predicate
        // never match — effectively disabling retries without tripping validation.
        o.Retry.MaxRetryAttempts = 1;
        o.Retry.ShouldHandle = _ => ValueTask.FromResult(false);
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(1);
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(2);
        o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(2); // must be >= 2 * AttemptTimeout
    }
}
```

- [ ] **Step 2: Write the failing GIS client test**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/GisApiClientTests.cs`:

```csharp
using System.Net;
using System.Net.Http;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterNetwork.Bff.Api.Http;

namespace WaterNetwork.Bff.UnitTests;

public sealed class GisApiClientTests
{
    private static GisApiClient Build(StubHttpMessageHandler inner) =>
        new(new HttpClient(inner) { BaseAddress = new Uri("http://gis.test") });

    [Fact]
    public async Task Ok_200_Returns_Ok_With_Body()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.OK, "{\"id\":\"n1\"}"));

        var result = await client.GetDetailAsync("node", "n1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Ok);
        result.Value!["id"]!.GetValue<string>().Should().Be("n1");
    }

    [Fact]
    public async Task Pipe_And_Device_Hit_Their_Routes()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        var client = Build(inner);

        await client.GetDetailAsync("pipe", "p1", CancellationToken.None);
        inner.LastRequest!.RequestUri!.AbsolutePath.Should().Be("/api/network/pipes/p1");

        await client.GetDetailAsync("device", "d1", CancellationToken.None);
        inner.LastRequest!.RequestUri!.AbsolutePath.Should().Be("/api/network/devices/d1");
    }

    [Fact]
    public async Task NotFound_404_Returns_NotFound()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.NotFound));

        var result = await client.GetDetailAsync("node", "missing", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.NotFound);
    }

    [Fact]
    public async Task ServerError_500_Returns_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.InternalServerError));

        var result = await client.GetDetailAsync("node", "n1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Unavailable);
    }

    [Fact]
    public async Task Network_Exception_Returns_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(_ => throw new HttpRequestException("boom")));

        var result = await client.GetDetailAsync("node", "n1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Unavailable);
    }

    [Fact]
    public async Task Map_500_Marks_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.InternalServerError));

        var result = await client.GetMapAsync("1,2,3,4", "node", 100, CancellationToken.None);

        result.Unavailable.Should().BeTrue();
    }

    [Fact]
    public async Task Map_Passthrough_Forwards_Status_Body_And_Query()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "[{\"id\":\"n1\"}]");
        var client = Build(inner);

        var result = await client.GetMapAsync("1,2,3,4", "node,pipe", 50, CancellationToken.None);

        result.Unavailable.Should().BeFalse();
        result.StatusCode.Should().Be(200);
        result.Body!.AsArray().Should().HaveCount(1);
        inner.LastRequest!.RequestUri!.PathAndQuery.Should()
            .Be("/api/network/assets?bbox=1,2,3,4&types=node,pipe&limit=50");
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj`
Expected: FAIL — `GisApiClient` / `IGisApiClient` do not exist.

- [ ] **Step 4: Implement the GIS client interface + class**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/IGisApiClient.cs`:

```csharp
using System.Text.Json.Nodes;

namespace WaterNetwork.Bff.Api.Http;

public interface IGisApiClient
{
    Task<DownstreamResult<JsonNode>> GetDetailAsync(string type, string id, CancellationToken ct);
    Task<MapPassthrough> GetMapAsync(string? bbox, string? types, int? limit, CancellationToken ct);
}
```

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/GisApiClient.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Polly.CircuitBreaker;
using Polly.Timeout;

namespace WaterNetwork.Bff.Api.Http;

public sealed class GisApiClient(HttpClient http) : IGisApiClient
{
    public async Task<DownstreamResult<JsonNode>> GetDetailAsync(string type, string id, CancellationToken ct)
    {
        var path = type switch
        {
            "node" => $"/api/network/nodes/{id}",
            "pipe" => $"/api/network/pipes/{id}",
            "device" => $"/api/network/devices/{id}",
            _ => throw new ArgumentOutOfRangeException(nameof(type), type, "type must be node|pipe|device")
        };

        try
        {
            using var resp = await http.GetAsync(path, ct);
            if (resp.StatusCode == HttpStatusCode.NotFound)
                return DownstreamResult<JsonNode>.NotFound;
            if (!resp.IsSuccessStatusCode)
                return DownstreamResult<JsonNode>.Unavailable;

            var body = await resp.Content.ReadFromJsonAsync<JsonNode>(ct);
            return body is null ? DownstreamResult<JsonNode>.Unavailable : DownstreamResult<JsonNode>.Ok(body);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException
            or TimeoutRejectedException or BrokenCircuitException)
        {
            return DownstreamResult<JsonNode>.Unavailable;
        }
    }

    public async Task<MapPassthrough> GetMapAsync(string? bbox, string? types, int? limit, CancellationToken ct)
    {
        var query = new List<string>();
        if (!string.IsNullOrWhiteSpace(bbox)) query.Add($"bbox={bbox}");
        if (!string.IsNullOrWhiteSpace(types)) query.Add($"types={types}");
        if (limit is not null) query.Add($"limit={limit}");
        var qs = query.Count > 0 ? "?" + string.Join("&", query) : "";

        try
        {
            using var resp = await http.GetAsync($"/api/network/assets{qs}", ct);
            if ((int)resp.StatusCode >= 500)
                return new MapPassthrough(Unavailable: true, 0, null);

            var body = await resp.Content.ReadFromJsonAsync<JsonNode>(ct);
            return new MapPassthrough(Unavailable: false, (int)resp.StatusCode, body);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException
            or TimeoutRejectedException or BrokenCircuitException)
        {
            return new MapPassthrough(Unavailable: true, 0, null);
        }
    }
}
```

> Note: the query is built without URL-encoding because `bbox`/`types`/`limit` are simple comma/number tokens; this keeps the WireMock assertion exact. The downstream GIS validation filter re-parses them.

- [ ] **Step 5: Write the failing Asset client test**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/AssetApiClientTests.cs`:

```csharp
using System.Net;
using System.Net.Http;
using FluentAssertions;
using WaterNetwork.Bff.Api.Http;

namespace WaterNetwork.Bff.UnitTests;

public sealed class AssetApiClientTests
{
    private static AssetApiClient Build(StubHttpMessageHandler inner) =>
        new(new HttpClient(inner) { BaseAddress = new Uri("http://asset.test") });

    [Fact]
    public async Task Ok_200_Maps_Profile_Subset()
    {
        const string json = """
        {"id":"a1","tenantId":"t1","assetType":"Node","assetCode":"N-1","status":"Active",
         "createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z",
         "technicalProfile":{"installationYear":2020,"manufacturer":"Acme"},"lifecycleHistory":[]}
        """;
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.OK, json));

        var result = await client.GetProfileAsync("a1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Ok);
        result.Value!.Status.Should().Be("Active");
        result.Value.AssetCode.Should().Be("N-1");
        result.Value.TechnicalProfile!["manufacturer"]!.GetValue<string>().Should().Be("Acme");
    }

    [Fact]
    public async Task NotFound_404_Returns_NotFound()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.NotFound));

        var result = await client.GetProfileAsync("missing", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.NotFound);
    }

    [Fact]
    public async Task ServerError_And_Forbidden_Return_Unavailable()
    {
        (await Build(new StubHttpMessageHandler(HttpStatusCode.InternalServerError))
            .GetProfileAsync("a1", CancellationToken.None)).Status.Should().Be(DownstreamStatus.Unavailable);

        (await Build(new StubHttpMessageHandler(HttpStatusCode.Forbidden))
            .GetProfileAsync("a1", CancellationToken.None)).Status.Should().Be(DownstreamStatus.Unavailable);
    }

    [Fact]
    public async Task Network_Exception_Returns_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(_ => throw new HttpRequestException("boom")));

        var result = await client.GetProfileAsync("a1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Unavailable);
    }
}
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj`
Expected: FAIL — `AssetApiClient` / `IAssetApiClient` do not exist.

- [ ] **Step 7: Implement the Asset client interface + class**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/IAssetApiClient.cs`:

```csharp
namespace WaterNetwork.Bff.Api.Http;

public interface IAssetApiClient
{
    Task<DownstreamResult<AssetProfile>> GetProfileAsync(string id, CancellationToken ct);
}
```

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Http/AssetApiClient.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Polly.CircuitBreaker;
using Polly.Timeout;

namespace WaterNetwork.Bff.Api.Http;

/// <summary>BFF-local projection of asset-be's profile — only the fields the overview surfaces.</summary>
public sealed record AssetProfile(string Id, string AssetCode, string Status, JsonNode? TechnicalProfile);

public sealed class AssetApiClient(HttpClient http) : IAssetApiClient
{
    public async Task<DownstreamResult<AssetProfile>> GetProfileAsync(string id, CancellationToken ct)
    {
        try
        {
            using var resp = await http.GetAsync($"/api/assets/{id}", ct);
            if (resp.StatusCode == HttpStatusCode.NotFound)
                return DownstreamResult<AssetProfile>.NotFound;
            if (!resp.IsSuccessStatusCode)
                return DownstreamResult<AssetProfile>.Unavailable;

            var profile = await resp.Content.ReadFromJsonAsync<AssetProfile>(ct);
            return profile is null
                ? DownstreamResult<AssetProfile>.Unavailable
                : DownstreamResult<AssetProfile>.Ok(profile);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException
            or TimeoutRejectedException or BrokenCircuitException)
        {
            return DownstreamResult<AssetProfile>.Unavailable;
        }
    }
}
```

> `ReadFromJsonAsync` uses Web defaults (camelCase, case-insensitive), so `AssetProfile` binds from `{id, assetCode, status, technicalProfile}` with no attributes. Extra fields (`tenantId`, `lifecycleHistory`, …) are ignored.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj`
Expected: PASS (all unit tests — handler + GIS client + asset client).

- [ ] **Step 9: Commit**

```bash
git add src/services/water-network-bff
git commit -m "feat(bff): typed GIS + asset downstream clients with tri-state results (BFF-1)"
```

---

## Task 4: DI wiring (typed clients + handler + resilience + options)

**Files:**
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Configuration/DownstreamOptions.cs`
- Modify: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Program.cs`

- [ ] **Step 1: Create the options type**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Configuration/DownstreamOptions.cs`:

```csharp
namespace WaterNetwork.Bff.Api.Configuration;

public sealed class DownstreamOptions
{
    public const string SectionName = "Downstream";
    public DownstreamEndpoint Gis { get; set; } = new();
    public DownstreamEndpoint Asset { get; set; } = new();
}

public sealed class DownstreamEndpoint
{
    public string BaseUrl { get; set; } = "";
}
```

- [ ] **Step 2: Wire options, handler, and typed clients in Program.cs**

In `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Program.cs`, add these usings at the top (with the existing ones):

```csharp
using Microsoft.Extensions.Options;
using WaterNetwork.Bff.Api.Configuration;
using WaterNetwork.Bff.Api.Http;
```

Then replace the line `builder.Services.AddHttpContextAccessor();` with the full wiring block:

```csharp
builder.Services.AddHttpContextAccessor();

builder.Services.Configure<DownstreamOptions>(
    builder.Configuration.GetSection(DownstreamOptions.SectionName));
builder.Services.AddTransient<AuthForwardingHandler>();

builder.Services.AddHttpClient<IGisApiClient, GisApiClient>((sp, client) =>
    {
        var options = sp.GetRequiredService<IOptions<DownstreamOptions>>().Value;
        client.BaseAddress = new Uri(options.Gis.BaseUrl);
    })
    .AddHttpMessageHandler<AuthForwardingHandler>()
    .AddStandardResilienceHandler(ResilienceConfig.Configure);

builder.Services.AddHttpClient<IAssetApiClient, AssetApiClient>((sp, client) =>
    {
        var options = sp.GetRequiredService<IOptions<DownstreamOptions>>().Value;
        client.BaseAddress = new Uri(options.Asset.BaseUrl);
    })
    .AddHttpMessageHandler<AuthForwardingHandler>()
    .AddStandardResilienceHandler(ResilienceConfig.Configure);
```

- [ ] **Step 3: Build to verify wiring compiles**

Run: `dotnet build src/services/water-network-bff/src/WaterNetwork.Bff.Api/WaterNetwork.Bff.Api.csproj`
Expected: Build succeeded, 0 warnings.

- [ ] **Step 4: Run the health test (still green after wiring)**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj`
Expected: PASS (health test).

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-bff
git commit -m "feat(bff): wire downstream http clients + resilience + options (BFF-1)"
```

---

## Task 5: Overview endpoint

**Files:**
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Contracts/OverviewResponse.cs`
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Endpoints/OverviewEndpointModule.cs`
- Test: `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/OverviewEndpointTests.cs`

- [ ] **Step 1: Write the failing overview integration tests**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/OverviewEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class OverviewEndpointTests
{
    private static HttpClient AuthedClient(BffApiFactory factory)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "u", tenantId: "tenant-1",
            permissions: ["network-gis:read", "network-asset:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add("X-Tenant-Id", "tenant-1");
        return client;
    }

    private static void StubGisNode(BffApiFactory f, string id, HttpStatusCode status, string? body = null) =>
        f.Gis.Given(Request.Create().WithPath($"/api/network/nodes/{id}").UsingGet())
            .RespondWith(Response.Create().WithStatusCode((int)status)
                .WithHeader("Content-Type", "application/json").WithBody(body ?? "{}"));

    private static void StubAsset(BffApiFactory f, string id, HttpStatusCode status, string? body = null) =>
        f.Asset.Given(Request.Create().WithPath($"/api/assets/{id}").UsingGet())
            .RespondWith(Response.Create().WithStatusCode((int)status)
                .WithHeader("Content-Type", "application/json").WithBody(body ?? "{}"));

    [Fact]
    public async Task Both_Ok_Returns_Full_Overview()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\",\"assetCode\":\"N-1\",\"nodeType\":\"Junction\"}");
        StubAsset(factory, "n1", HttpStatusCode.OK,
            "{\"id\":\"n1\",\"assetCode\":\"N-1\",\"status\":\"Active\",\"technicalProfile\":{\"manufacturer\":\"Acme\"}}");
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["assetId"]!.GetValue<string>().Should().Be("n1");
        body["type"]!.GetValue<string>().Should().Be("node");
        body["gis"]!["nodeType"]!.GetValue<string>().Should().Be("Junction");
        body["lifecycle"]!["status"]!.GetValue<string>().Should().Be("Active");
        body["sources"]!["gis"]!.GetValue<string>().Should().Be("ok");
        body["sources"]!["asset"]!.GetValue<string>().Should().Be("ok");
    }

    [Fact]
    public async Task Asset_Down_Degrades_To_Null_Lifecycle()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\"}");
        StubAsset(factory, "n1", HttpStatusCode.InternalServerError);
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["lifecycle"].Should().BeNull();
        body["sources"]!["asset"]!.GetValue<string>().Should().Be("unavailable");
    }

    [Fact]
    public async Task Asset_404_Degrades_To_Null_Lifecycle()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\"}");
        StubAsset(factory, "n1", HttpStatusCode.NotFound);
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!["lifecycle"].Should().BeNull();
        body["sources"]!["asset"]!.GetValue<string>().Should().Be("unavailable");
    }

    [Fact]
    public async Task Gis_404_Returns_404()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "missing", HttpStatusCode.NotFound);
        StubAsset(factory, "missing", HttpStatusCode.OK, "{\"id\":\"missing\",\"assetCode\":\"x\",\"status\":\"Active\"}");
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/missing/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Gis_Down_Returns_502()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.InternalServerError);
        StubAsset(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\",\"assetCode\":\"x\",\"status\":\"Active\"}");
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.BadGateway);
    }

    [Fact]
    public async Task Invalid_Type_Returns_400()
    {
        using var factory = new BffApiFactory();
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=zone");

        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        using var factory = new BffApiFactory();
        using var client = factory.CreateClient();

        var resp = await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Forwards_Auth_And_Tenant_To_Downstream()
    {
        using var factory = new BffApiFactory();
        StubGisNode(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\"}");
        StubAsset(factory, "n1", HttpStatusCode.OK, "{\"id\":\"n1\",\"assetCode\":\"x\",\"status\":\"Active\"}");
        using var client = AuthedClient(factory);

        await client.GetAsync("/bff/water-network/assets/n1/overview?type=node");

        var gisReq = factory.Gis.LogEntries.Single().RequestMessage;
        gisReq.Headers!.Should().ContainKey("Authorization");
        gisReq.Headers!["X-Tenant-Id"].Should().Contain("tenant-1");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj`
Expected: FAIL — overview route returns 404 (not mapped yet); the `No_Token_Returns_401` may pass incidentally — that's fine.

- [ ] **Step 3: Create the response contract**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Contracts/OverviewResponse.cs`:

```csharp
using System.Text.Json.Nodes;

namespace WaterNetwork.Bff.Api.Contracts;

public sealed record OverviewResponse(
    string AssetId,
    string Type,
    JsonNode? Gis,
    LifecycleDto? Lifecycle,
    SourcesDto Sources);

public sealed record LifecycleDto(string Status, string AssetCode, JsonNode? TechnicalProfile);

public sealed record SourcesDto(string Gis, string Asset);
```

- [ ] **Step 4: Implement the overview endpoint module**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Endpoints/OverviewEndpointModule.cs`:

```csharp
using Microsoft.AspNetCore.Http;
using WaterNetwork.Bff.Api.Contracts;
using WaterNetwork.Bff.Api.Http;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Bff.Api.Endpoints;

public sealed class OverviewEndpointModule : IEndpointModule
{
    private static readonly string[] ValidTypes = ["node", "pipe", "device"];

    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/bff/water-network/assets");

        group.MapGet("/{assetId}/overview", async (
                string assetId,
                string? type,
                IGisApiClient gis,
                IAssetApiClient asset,
                CancellationToken ct) =>
            {
                var t = (type ?? string.Empty).ToLowerInvariant();
                if (Array.IndexOf(ValidTypes, t) < 0)
                    return Results.Problem("Query parameter 'type' must be one of node|pipe|device.", statusCode: 400);

                // Fan out concurrently: both calls start before we await either.
                var gisTask = gis.GetDetailAsync(t, assetId, ct);
                var assetTask = asset.GetProfileAsync(assetId, ct);
                var gisResult = await gisTask;
                var assetResult = await assetTask;

                // GIS is authoritative for existence.
                if (gisResult.Status == DownstreamStatus.NotFound)
                    return Results.NotFound();
                if (gisResult.Status != DownstreamStatus.Ok)
                    return Results.Problem("GIS source unavailable.", statusCode: 502);

                // Asset degrades to null — never blocks the response.
                LifecycleDto? lifecycle = null;
                var assetSource = "unavailable";
                if (assetResult.Status == DownstreamStatus.Ok && assetResult.Value is not null)
                {
                    var p = assetResult.Value;
                    lifecycle = new LifecycleDto(p.Status, p.AssetCode, p.TechnicalProfile);
                    assetSource = "ok";
                }

                var response = new OverviewResponse(
                    assetId, t, gisResult.Value, lifecycle, new SourcesDto("ok", assetSource));
                return Results.Ok(response);
            })
            .RequireAuthorization();
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj`
Expected: PASS (health + all overview tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/water-network-bff
git commit -m "feat(bff): asset overview endpoint (GIS authoritative, asset degrade) (BFF-1)"
```

---

## Task 6: Map endpoint

**Files:**
- Create: `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Endpoints/MapEndpointModule.cs`
- Test: `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/MapEndpointTests.cs`

- [ ] **Step 1: Write the failing map integration tests**

Create `src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/MapEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class MapEndpointTests
{
    private static HttpClient AuthedClient(BffApiFactory factory)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "u", tenantId: "tenant-1", permissions: ["network-gis:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Passthrough_Returns_Bbox_Body()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(200)
                .WithHeader("Content-Type", "application/json")
                .WithBody("[{\"id\":\"n1\",\"lifecycleStatus\":\"Active\"}]"));
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/map?bbox=1,2,3,4&types=node");

        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonNode>();
        body!.AsArray().Should().HaveCount(1);
        body[0]!["lifecycleStatus"]!.GetValue<string>().Should().Be("Active");
    }

    [Fact]
    public async Task Gis_Down_Returns_502()
    {
        using var factory = new BffApiFactory();
        factory.Gis.Given(Request.Create().WithPath("/api/network/assets").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(500));
        using var client = AuthedClient(factory);

        var resp = await client.GetAsync("/bff/water-network/map?bbox=1,2,3,4");

        resp.StatusCode.Should().Be(HttpStatusCode.BadGateway);
    }

    [Fact]
    public async Task No_Token_Returns_401()
    {
        using var factory = new BffApiFactory();
        using var client = factory.CreateClient();

        var resp = await client.GetAsync("/bff/water-network/map?bbox=1,2,3,4");

        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj`
Expected: FAIL — map route returns 404 (not mapped yet).

- [ ] **Step 3: Implement the map endpoint module**

Create `src/services/water-network-bff/src/WaterNetwork.Bff.Api/Endpoints/MapEndpointModule.cs`:

```csharp
using Microsoft.AspNetCore.Http;
using WaterNetwork.Bff.Api.Http;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Bff.Api.Endpoints;

public sealed class MapEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/bff/water-network/map");

        group.MapGet("/", async (
                string? bbox,
                string? types,
                int? limit,
                IGisApiClient gis,
                CancellationToken ct) =>
            {
                var result = await gis.GetMapAsync(bbox, types, limit, ct);
                return result.Unavailable
                    ? Results.Problem("GIS source unavailable.", statusCode: 502)
                    : Results.Json(result.Body, statusCode: result.StatusCode);
            })
            .RequireAuthorization();
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj`
Expected: PASS (health + overview + map tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/water-network-bff
git commit -m "feat(bff): map bbox passthrough endpoint (BFF-1)"
```

---

## Task 7: Dockerfile, docker-compose, docs, full verification

**Files:**
- Create: `src/services/water-network-bff/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `docs/stories/backlog.md`
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`

- [ ] **Step 1: Create the Dockerfile**

Create `src/services/water-network-bff/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/ src/
RUN dotnet publish src/services/water-network-bff/src/WaterNetwork.Bff.Api -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "WaterNetwork.Bff.Api.dll"]
```

- [ ] **Step 2: Add the compose service**

In `docker-compose.yml`, add this service entry immediately after the `water-network-asset-be:` block (before the `volumes:` line). It uses container-internal URLs for the two downstreams on the shared network:

```yaml
  water-network-bff:
    build:
      context: .
      dockerfile: src/services/water-network-bff/Dockerfile
    ports: ["8083:8080"]
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - Downstream__Gis__BaseUrl=http://water-network-gis-be:8080
      - Downstream__Asset__BaseUrl=http://water-network-asset-be:8080
      - OpenTelemetry__OtlpEndpoint=http://jaeger:4317
    depends_on:
      - water-network-gis-be
      - water-network-asset-be
    networks: [wn-network]
```

- [ ] **Step 3: Verify docker-compose is valid**

Run: `docker compose config --quiet && echo OK`
Expected: `OK` (no YAML/schema errors). If Docker is unavailable in the environment, skip and note it.

- [ ] **Step 4: Run the full BFF solution test suite (0 warnings gate)**

Run both test projects:

```bash
dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.UnitTests/WaterNetwork.Bff.UnitTests.csproj
dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj
```

Expected: both PASS, build reports 0 warnings (project has `TreatWarningsAsErrors=true` via `Directory.Build.props`, so any warning fails the build).

- [ ] **Step 5: Update the backlog — Phase 1 done**

In `docs/stories/backlog.md`, change the Phase 1 row Status cell from:

```
| Phase 1 — GIS + Asset Core | gis-be pipe/device/remove/bbox, asset-be lifecycle, GIS status projection, BFF overview (US-P1-02..07) | in progress (GIS-1, GIS-2, GIS-3, GIS-4, AST-1, AST-2, GIS-5 done) |
```

to:

```
| Phase 1 — GIS + Asset Core | gis-be pipe/device/remove/bbox, asset-be lifecycle, GIS status projection, BFF overview (US-P1-02..07) | done (GIS-1..5, AST-1, AST-2, BFF-1) |
```

Then add a new follow-up section at the end of the file:

```markdown
## Follow-up sau BFF-1 Overview + Map

- **Search endpoint hoãn**: `GET /bff/water-network/assets/search?q=` chưa làm — GIS chưa có search
  upstream. Cần slice GIS-6 (search/filter theo asset_code/type) rồi BFF-n thêm endpoint.
- **YARP gateway route**: BFF chạy như service riêng (port 8083). Gắn route qua gateway thuộc
  cross-cutting US-X (chưa kích hoạt).
- **Overview cần `type` query param**: FE phải truyền `?type=node|pipe|device` (GIS detail tách
  route theo type, không có endpoint hợp nhất). Nếu sau muốn bỏ `type`, thêm `GET /api/network/assets/{id}`
  hợp nhất ở gis-be (GIS-6+) rồi BFF gọi 1:1.
- **Resilience timeout chưa test qua integration**: 5xx→502 cover bằng WireMock; timeout/circuit-open
  cover bằng unit test client (exception→Unavailable). Thêm WireMock `WithDelay` test nếu cần SLA thật.
- **Caching**: chưa có; thêm response cache/ETag khi đo tải thật.
```

- [ ] **Step 6: Tick the roadmap slice row**

In `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`, in the §3.3 table, change the BFF-1 row from:

```
| 1 | BFF-1 Asset overview + map search | bff | US-P1-07 | GIS-4, AST-2 |
```

to:

```
| 1 | BFF-1 Asset overview + map ✓ | bff | US-P1-07 | GIS-4, AST-2 |
```

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-bff/Dockerfile docker-compose.yml docs/stories/backlog.md docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md
git commit -m "chore(bff): dockerfile, compose service, close Phase 1 tracking (BFF-1)"
```

---

## Done criteria

- `water-network-bff` solution: unit + integration tests green, 0 warnings.
- `GET /bff/water-network/assets/{id}/overview?type=` behaves per the spec error table (GIS 404→404, GIS down→502, asset failure→`lifecycle:null` + `sources.asset:"unavailable"`, both ok→full).
- `GET /bff/water-network/map` passes GIS bbox through (incl `lifecycleStatus`), GIS down→502.
- JWT bearer + `X-Tenant-Id` forwarded to downstream (asserted in integration test).
- Dockerfile + `docker-compose.yml` entry (port 8083) added; compose validates.
- Backlog Phase 1 = done; roadmap BFF-1 row ticked.
