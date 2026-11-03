# US-X-01 Cross-Tenant Mutation Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Stop an authenticated caller in tenant B from mutating (relocate / remove / suspend / decommission / etc.) a gis-be or asset-be aggregate owned by tenant A, by making the mutation load path tenant-scoped so a cross-tenant id resolves to a 404.

**Architecture:** Each affected repository interface gains a **new overload** `GetByIdAsync(string tenantId, string id, ct)` that filters `WHERE id = @id AND tenant_id = @tenantId`. Load-then-mutate command handlers switch to this overload, passing the caller's `tenant.TenantId`. A tenant mismatch returns `null`, and each handler's existing `?? throw NotFoundException` produces a 404 (not 403 — avoids id-enumeration). The existing id-only `GetByIdAsync(id, ct)` is kept untouched for reference lookups (`RegisterPipe`/`InstallDevice`) and consumers, so reference guard (b) stays deferred and design-be is untouched.

**Tech Stack:** .NET 10, EF Core (mutation path), NSubstitute + xUnit + FluentAssertions (tests), PostgisFixture (integration), `DevJwtTokenFactory` for per-tenant JWTs.

**Spec:** `docs/superpowers/specs/2026-06-17-usx01-cross-tenant-mutation-guard-design.md`

**Run tests per-csproj** (SDK `.slnx` footgun runs 0 tests). Integration tests need Docker (PostgisFixture).

---

## File Structure

**gis-be (modify):**
- `src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Repositories/INetworkNodeRepository.cs` — add overload
- `.../INetworkPipeRepository.cs`, `.../INetworkDeviceRepository.cs` — add overload
- `.../WaterNetwork.Gis.Infrastructure/Repositories/NetworkNodeRepository.cs` — implement overload
- `.../NetworkPipeRepository.cs`, `.../NetworkDeviceRepository.cs` — implement overload
- `.../WaterNetwork.Gis.Application/Commands/RelocateNodeCommandHandler.cs` — use overload
- `.../RemoveNodeCommandHandler.cs`, `.../RemovePipeCommandHandler.cs`, `.../RemoveDeviceCommandHandler.cs` — inject tenant + use overload
- tests: update `RelocateNodeCommandHandlerTests`, `RemoveNodeCommandHandlerTests`, `RemovePipeCommandHandlerTests`, `RemoveDeviceCommandHandlerTests`; add `CrossTenantMutationGuardApiTests`

**asset-be (modify):**
- `src/services/water-network-asset-be/src/WaterNetwork.Asset.Domain/Repositories/INetworkAssetRepository.cs` — add overload
- `.../WaterNetwork.Asset.Infrastructure/Repositories/NetworkAssetRepository.cs` — implement overload
- `.../WaterNetwork.Asset.Application/Commands/{Activate,Suspend,MarkAssetAsMaintenance,Decommission,UpdateAssetTechnicalProfile}CommandHandler.cs` — use overload
- tests: update `AssetLifecycleCommandHandlerTests`; add `CrossTenantMutationGuardApiTests`

**docs (create/modify):**
- `docs/decisions/0016-cross-tenant-mutation-guard.md` — new
- `docs/stories/backlog.md` — mark ⚠️ HIGH item resolved

**Untouched (by design):** building-blocks `IAggregateRepository<T>`; all of design-be; gis `RegisterPipe`/`InstallDevice` reference lookups; `DeleteAsync`; read DAOs.

---

## Task 1: gis-be — tenant-scoped load overload on node repository

**Files:**
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Repositories/INetworkNodeRepository.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/NetworkNodeRepository.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/CrossTenantRepositoryTests.cs` (create)

- [x] **Step 1: Write the failing repository test**

Create `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/CrossTenantRepositoryTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class CrossTenantRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task NodeRepository_GetByIdAsync_TenantScoped_Returns_Null_For_Other_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();

        var node = NetworkNode.Register("tenant-A", new AssetCode("ND-XT-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));
        await repo.SaveAsync(node);

        (await repo.GetByIdAsync("tenant-A", node.Id)).Should().NotBeNull("owning tenant can load");
        (await repo.GetByIdAsync("tenant-B", node.Id)).Should().BeNull("other tenant must not load");
    }
}
```

- [x] **Step 2: Run test — verify it fails to compile**

Run: `dotnet build src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj`
Expected: FAIL — `INetworkNodeRepository` has no `GetByIdAsync(string, string)` overload.

- [x] **Step 3: Add the overload to the interface**

In `INetworkNodeRepository.cs`, add below the existing `GetByIdAsync(string id, ...)` line:

```csharp
    Task<NetworkNode?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
```

- [x] **Step 4: Implement the overload in the repository**

In `NetworkNodeRepository.cs`, add directly below the existing `GetByIdAsync(string id, ...)` override:

```csharp
    public async Task<NetworkNode?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkNodes.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return model is null ? null : ToDomain(model);
    }
```

- [x] **Step 5: Run the test — verify it passes**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter "FullyQualifiedName~CrossTenantRepositoryTests.NodeRepository"`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Repositories/INetworkNodeRepository.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/NetworkNodeRepository.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/CrossTenantRepositoryTests.cs
git commit -m "feat(gis): US-X-01 tenant-scoped GetByIdAsync overload on node repo (US-X-01)"
```

---

## Task 2: gis-be — tenant-scoped overload on pipe + device repositories

**Files:**
- Modify: `.../WaterNetwork.Gis.Domain/Repositories/INetworkPipeRepository.cs`
- Modify: `.../WaterNetwork.Gis.Domain/Repositories/INetworkDeviceRepository.cs`
- Modify: `.../WaterNetwork.Gis.Infrastructure/Repositories/NetworkPipeRepository.cs`
- Modify: `.../WaterNetwork.Gis.Infrastructure/Repositories/NetworkDeviceRepository.cs`
- Test: `.../CrossTenantRepositoryTests.cs` (extend)

- [x] **Step 1: Add failing tests for pipe + device**

Append two facts to `CrossTenantRepositoryTests` (add `using NetTopologySuite` not needed — reuse VOs). Insert inside the class:

```csharp
    [Fact]
    public async Task PipeRepository_GetByIdAsync_TenantScoped_Returns_Null_For_Other_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkPipeRepository>();

        var pipe = NetworkPipe.Register("tenant-A", new AssetCode("PP-XT-1"), "node-a", "node-b",
            new PipeGeometry(new[] { new GeoPoint(10.0, 106.0), new GeoPoint(10.1, 106.1) }),
            new Diameter(150), PipeMaterial.Parse("HDPE"), 100.0, null);
        await repo.SaveAsync(pipe);

        (await repo.GetByIdAsync("tenant-A", pipe.Id)).Should().NotBeNull();
        (await repo.GetByIdAsync("tenant-B", pipe.Id)).Should().BeNull();
    }

    [Fact]
    public async Task DeviceRepository_GetByIdAsync_TenantScoped_Returns_Null_For_Other_Tenant()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkDeviceRepository>();

        var device = NetworkDevice.Install("tenant-A", new AssetCode("DV-XT-1"),
            DeviceType.Parse("Valve"), DeviceHost.For(DeviceType.Parse("Valve"), "pipe-x", null),
            new GeoPoint(10.0, 106.0));
        await repo.SaveAsync(device);

        (await repo.GetByIdAsync("tenant-A", device.Id)).Should().NotBeNull();
        (await repo.GetByIdAsync("tenant-B", device.Id)).Should().BeNull();
    }
```

- [x] **Step 2: Run — verify compile failure**

Run: `dotnet build src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj`
Expected: FAIL — pipe/device interfaces lack the overload.

- [x] **Step 3: Add overloads to both interfaces**

In `INetworkPipeRepository.cs` add:

```csharp
    Task<NetworkPipe?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
```

In `INetworkDeviceRepository.cs` add:

```csharp
    Task<NetworkDevice?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
```

- [x] **Step 4: Implement overloads in both repositories**

In `NetworkPipeRepository.cs`, below the existing `GetByIdAsync(string id, ...)` override:

```csharp
    public async Task<NetworkPipe?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkPipes.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return model is null ? null : ToDomain(model);
    }
```

In `NetworkDeviceRepository.cs`, below the existing `GetByIdAsync(string id, ...)` override:

```csharp
    public async Task<NetworkDevice?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkDevices.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return model is null ? null : ToDomain(model);
    }
```

- [x] **Step 5: Run the tests — verify pass**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter "FullyQualifiedName~CrossTenantRepositoryTests"`
Expected: PASS (3 tests: node, pipe, device).

- [x] **Step 6: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Repositories/INetworkPipeRepository.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Domain/Repositories/INetworkDeviceRepository.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/NetworkPipeRepository.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/NetworkDeviceRepository.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/CrossTenantRepositoryTests.cs
git commit -m "feat(gis): US-X-01 tenant-scoped GetByIdAsync overload on pipe+device repos (US-X-01)"
```

---

## Task 3: gis-be — RelocateNodeCommandHandler uses tenant overload

**Files:**
- Modify: `.../WaterNetwork.Gis.Application/Commands/RelocateNodeCommandHandler.cs:26`
- Test: `.../WaterNetwork.Gis.UnitTests/Application/RelocateNodeCommandHandlerTests.cs`

The handler already resolves `tenant`. Switch its load to the overload, and update the existing unit-test stubs (which stub the id-only overload) to the tenant overload.

- [x] **Step 1: Update unit-test stubs to the tenant overload**

In `RelocateNodeCommandHandlerTests.cs`, the handler's tenant is `"tenant-001"` (set in `CreateHandler`). Replace every stub of the form `_nodeRepository.GetByIdAsync(node.Id, Arg.Any<CancellationToken>())` with the tenant overload. There are 5 occurrences (lines 42, 89, 109, 127, 149) plus the missing-node stub on line 69. Apply:

- `_nodeRepository.GetByIdAsync(node.Id, Arg.Any<CancellationToken>()).Returns(node);`
  → `_nodeRepository.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);`
- `_nodeRepository.GetByIdAsync("node-missing", Arg.Any<CancellationToken>()).Returns((NetworkNode?)null);`
  → `_nodeRepository.GetByIdAsync("tenant-001", "node-missing", Arg.Any<CancellationToken>()).Returns((NetworkNode?)null);`

- [x] **Step 2: Add a cross-tenant unit test**

Append to `RelocateNodeCommandHandlerTests`:

```csharp
    // 7. Cross-tenant: node belongs to another tenant → overload returns null → NotFound, no Save.
    [Fact]
    public async Task Handle_Node_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Save()
    {
        var node = MakeNode();
        // Overload stubbed ONLY for the owning tenant; caller is "tenant-001" → no match → null.
        _nodeRepository.GetByIdAsync("tenant-999", node.Id, Arg.Any<CancellationToken>()).Returns(node);

        var handler = CreateHandler();
        var command = new RelocateNodeCommand(node.Id, 10.5, 106.5, null);

        await handler.Invoking(h => h.HandleAsync(command, CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
        await _nodeRepository.DidNotReceive().SaveAsync(Arg.Any<NetworkNode>(), Arg.Any<CancellationToken>());
    }
```

- [x] **Step 3: Run — verify failure**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj --filter "FullyQualifiedName~RelocateNodeCommandHandlerTests"`
Expected: FAIL — handler still calls the id-only overload, so the tenant stubs don't match and happy-path tests get `null`.

- [x] **Step 4: Update the handler**

In `RelocateNodeCommandHandler.cs`, change line 26:

```csharp
        var node = await nodeRepository.GetByIdAsync(tenant.TenantId, command.NodeId, ct)
            ?? throw NotFoundException.Entity("NetworkNode", command.NodeId);
```

- [x] **Step 5: Run — verify pass**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj --filter "FullyQualifiedName~RelocateNodeCommandHandlerTests"`
Expected: PASS (all original tests + the new cross-tenant test).

- [x] **Step 6: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Commands/RelocateNodeCommandHandler.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/RelocateNodeCommandHandlerTests.cs
git commit -m "feat(gis): US-X-01 RelocateNode loads node tenant-scoped (US-X-01)"
```

---

## Task 4: gis-be — Remove handlers inject tenant + use overload

`RemoveNode/Pipe/DeviceCommandHandler` currently do NOT inject `ITenantContextAccessor`. Add it, guard for null, and load via the tenant overload. `ITenantContextAccessor` is already DI-registered (used by Relocate), so no DI wiring change is needed. `DeleteAsync(id)` stays id-only (the tenant-scoped load 404s first; the delete re-loads the same globally-unique row).

**Files:**
- Modify: `.../Commands/RemoveNodeCommandHandler.cs`, `.../RemovePipeCommandHandler.cs`, `.../RemoveDeviceCommandHandler.cs`
- Test: `.../WaterNetwork.Gis.UnitTests/Application/{RemoveNode,RemovePipe,RemoveDevice}CommandHandlerTests.cs`

- [x] **Step 1: Update the three unit-test files (stubs + ctor + cross-tenant test)**

**RemoveNodeCommandHandlerTests.cs:**
- Add usings at top:
  ```csharp
  using WaterPlatform.BuildingBlocks.Domain.Exceptions;
  using WaterPlatform.BuildingBlocks.MultiTenancy;
  ```
  (`WaterPlatform.BuildingBlocks.Domain.Exceptions` is already imported — only add the MultiTenancy using.)
- Add a tenant field after line 16:
  ```csharp
  private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();
  ```
- Replace `CreateHandler()`:
  ```csharp
  private RemoveNodeCommandHandler CreateHandler()
  {
      _tenant.Current.Returns(new TenantContext("tenant-001"));
      return new(_nodeRepo, _pipeRepo, _deviceRepo, _tenant);
  }
  ```
- Replace the two node stubs:
  - `_nodeRepo.GetByIdAsync(node.Id, Arg.Any<CancellationToken>()).Returns(node);` → `_nodeRepo.GetByIdAsync("tenant-001", node.Id, Arg.Any<CancellationToken>()).Returns(node);` (3 occurrences: lines 29, 57, 73)
  - `_nodeRepo.GetByIdAsync("node-missing", Arg.Any<CancellationToken>()).Returns((NetworkNode?)null);` → `_nodeRepo.GetByIdAsync("tenant-001", "node-missing", Arg.Any<CancellationToken>()).Returns((NetworkNode?)null);`
- Append a cross-tenant test:
  ```csharp
  // 5. Cross-tenant: node owned by another tenant → NotFound, DeleteAsync DidNotReceive.
  [Fact]
  public async Task Handle_Node_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Delete()
  {
      var node = MakeNode();
      _nodeRepo.GetByIdAsync("tenant-999", node.Id, Arg.Any<CancellationToken>()).Returns(node);

      var handler = CreateHandler();
      await handler.Invoking(h => h.HandleAsync(new RemoveNodeCommand(node.Id), CancellationToken.None))
          .Should().ThrowAsync<NotFoundException>();
      await _nodeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
  }
  ```

**RemovePipeCommandHandlerTests.cs:**
- Add `using WaterPlatform.BuildingBlocks.MultiTenancy;`.
- Add field after line 15: `private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();`
- Replace `CreateHandler()`:
  ```csharp
  private RemovePipeCommandHandler CreateHandler()
  {
      _tenant.Current.Returns(new TenantContext("tenant-001"));
      return new(_pipeRepo, _deviceRepo, _tenant);
  }
  ```
- Stubs: `_pipeRepo.GetByIdAsync(pipe.Id, Arg.Any<CancellationToken>())` → `_pipeRepo.GetByIdAsync("tenant-001", pipe.Id, Arg.Any<CancellationToken>())` (lines 30, 57); `_pipeRepo.GetByIdAsync("pipe-missing", ...)` → `_pipeRepo.GetByIdAsync("tenant-001", "pipe-missing", ...)`.
- Append:
  ```csharp
  [Fact]
  public async Task Handle_Pipe_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Delete()
  {
      var pipe = MakePipe();
      _pipeRepo.GetByIdAsync("tenant-999", pipe.Id, Arg.Any<CancellationToken>()).Returns(pipe);

      var handler = CreateHandler();
      await handler.Invoking(h => h.HandleAsync(new RemovePipeCommand(pipe.Id), CancellationToken.None))
          .Should().ThrowAsync<NotFoundException>();
      await _pipeRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
  }
  ```

**RemoveDeviceCommandHandlerTests.cs:**
- Add `using WaterPlatform.BuildingBlocks.MultiTenancy;`.
- Add field after line 14: `private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();`
- Replace `CreateHandler()`:
  ```csharp
  private RemoveDeviceCommandHandler CreateHandler()
  {
      _tenant.Current.Returns(new TenantContext("tenant-001"));
      return new(_deviceRepo, _tenant);
  }
  ```
- Stubs: `_deviceRepo.GetByIdAsync(device.Id, ...)` → `_deviceRepo.GetByIdAsync("tenant-001", device.Id, ...)` (line 30); `_deviceRepo.GetByIdAsync("device-missing", ...)` → `_deviceRepo.GetByIdAsync("tenant-001", "device-missing", ...)`.
- Append:
  ```csharp
  [Fact]
  public async Task Handle_Device_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Delete()
  {
      var device = MakeDevice();
      _deviceRepo.GetByIdAsync("tenant-999", device.Id, Arg.Any<CancellationToken>()).Returns(device);

      var handler = CreateHandler();
      await handler.Invoking(h => h.HandleAsync(new RemoveDeviceCommand(device.Id), CancellationToken.None))
          .Should().ThrowAsync<NotFoundException>();
      await _deviceRepo.DidNotReceive().DeleteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
  }
  ```

- [x] **Step 2: Run — verify failure**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj --filter "FullyQualifiedName~Remove"`
Expected: FAIL — handlers' ctors don't accept `ITenantContextAccessor` (compile error).

- [x] **Step 3: Update RemoveNodeCommandHandler**

Replace the whole file with:

```csharp
using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RemoveNodeCommandHandler(
    INetworkNodeRepository nodeRepository,
    INetworkPipeRepository pipeRepository,
    INetworkDeviceRepository deviceRepository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<RemoveNodeCommand, Unit>
{
    public async Task<Unit> HandleAsync(RemoveNodeCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to remove a node.");

        // Tenant-scoped load: a node owned by another tenant resolves to null → 404 (anti-enumeration).
        var node = await nodeRepository.GetByIdAsync(tenant.TenantId, command.NodeId, ct)
            ?? throw NotFoundException.Entity("NetworkNode", command.NodeId);

        if (await pipeRepository.ExistsByEndpointNodeAsync(node.Id, ct))
            throw new BusinessRuleException(
                "NetworkNode.HasConnectedPipes",
                $"Node '{node.Id}' is an endpoint of one or more pipes and cannot be removed.");

        if (await deviceRepository.ExistsByHostNodeAsync(node.Id, ct))
            throw new BusinessRuleException(
                "NetworkNode.HasAttachedDevices",
                $"Node '{node.Id}' hosts one or more devices and cannot be removed.");

        await nodeRepository.DeleteAsync(node.Id, ct);

        return Unit.Value;
    }
}
```

- [x] **Step 4: Update RemovePipeCommandHandler**

Replace the whole file with:

```csharp
using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RemovePipeCommandHandler(
    INetworkPipeRepository pipeRepository,
    INetworkDeviceRepository deviceRepository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<RemovePipeCommand, Unit>
{
    public async Task<Unit> HandleAsync(RemovePipeCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to remove a pipe.");

        var pipe = await pipeRepository.GetByIdAsync(tenant.TenantId, command.PipeId, ct)
            ?? throw NotFoundException.Entity("NetworkPipe", command.PipeId);

        if (await deviceRepository.ExistsByHostPipeAsync(pipe.Id, ct))
            throw new BusinessRuleException(
                "NetworkPipe.HasAttachedDevices",
                $"Pipe '{pipe.Id}' hosts one or more devices and cannot be removed.");

        await pipeRepository.DeleteAsync(pipe.Id, ct);

        return Unit.Value;
    }
}
```

- [x] **Step 5: Update RemoveDeviceCommandHandler**

Replace the whole file with:

```csharp
using WaterNetwork.Gis.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Gis.Application.Commands;

public sealed class RemoveDeviceCommandHandler(
    INetworkDeviceRepository deviceRepository,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<RemoveDeviceCommand, Unit>
{
    public async Task<Unit> HandleAsync(RemoveDeviceCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to remove a device.");

        var device = await deviceRepository.GetByIdAsync(tenant.TenantId, command.DeviceId, ct)
            ?? throw NotFoundException.Entity("NetworkDevice", command.DeviceId);

        await deviceRepository.DeleteAsync(device.Id, ct);

        return Unit.Value;
    }
}
```

- [x] **Step 6: Run — verify pass**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj --filter "FullyQualifiedName~Remove"`
Expected: PASS (all original Remove tests + 3 new cross-tenant tests).

- [x] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Commands/RemoveNodeCommandHandler.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Commands/RemovePipeCommandHandler.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Commands/RemoveDeviceCommandHandler.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/RemoveNodeCommandHandlerTests.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/RemovePipeCommandHandlerTests.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/Application/RemoveDeviceCommandHandlerTests.cs
git commit -m "feat(gis): US-X-01 Remove handlers load tenant-scoped (US-X-01)"
```

---

## Task 5: gis-be — cross-tenant API integration test (end-to-end 404)

**Files:**
- Test: `.../WaterNetwork.Gis.IntegrationTests/CrossTenantMutationGuardApiTests.cs` (create)

- [x] **Step 1: Write the integration test**

Create `CrossTenantMutationGuardApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class CrossTenantMutationGuardApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static HttpClient ClientFor(GisApiFactory factory, string tenantId)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "test-user", tenantId: tenantId,
            permissions: new[] { "network-gis:write", "network-gis:read" });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Tenant_B_Cannot_Relocate_Or_Remove_Tenant_A_Assets()
    {
        await using var factory = new GisApiFactory(postgis);
        using var tenantA = ClientFor(factory, "tenant-A");
        using var tenantB = ClientFor(factory, "tenant-B");

        // Seed node + hosted device under tenant A.
        var nodeResp = await tenantA.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16],
            nodeType = "Junction", latitude = 10.0, longitude = 106.0
        });
        nodeResp.StatusCode.Should().Be(HttpStatusCode.Created);
        var nodeId = (await nodeResp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];

        var deviceResp = await tenantA.PostAsJsonAsync("/api/network/devices", new
        {
            assetCode = $"DV-{Guid.NewGuid():N}"[..16],
            deviceType = "Pump", hostNodeId = nodeId,
            latitude = 10.0, longitude = 106.0
        });
        deviceResp.StatusCode.Should().Be(HttpStatusCode.Created);
        var deviceId = (await deviceResp.Content.ReadFromJsonAsync<Dictionary<string, string>>())!["id"];

        // Tenant B mutations all 404.
        (await tenantB.PatchAsJsonAsync($"/api/network/nodes/{nodeId}/location",
            new { latitude = 11.0, longitude = 107.0 })).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await tenantB.DeleteAsync($"/api/network/devices/{deviceId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await tenantB.DeleteAsync($"/api/network/nodes/{nodeId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // DB unchanged: no relocate/delete outbox rows produced by tenant B's attempts.
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            db.OutboxEntries.Any(e => e.AggregateId == nodeId && e.EventType == "NodeRelocated").Should().BeFalse();
            db.OutboxEntries.Any(e => e.AggregateId == nodeId && e.EventType == "NodeDeleted").Should().BeFalse();
            db.OutboxEntries.Any(e => e.AggregateId == deviceId && e.EventType == "DeviceDeleted").Should().BeFalse();
        }

        // Control: tenant A (the owner) can still relocate its own node.
        (await tenantA.PatchAsJsonAsync($"/api/network/nodes/{nodeId}/location",
            new { latitude = 10.5, longitude = 106.5 })).StatusCode.Should().Be(HttpStatusCode.NoContent);
    }
}
```

- [x] **Step 2: Run — verify pass**

Run: `dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj --filter "FullyQualifiedName~CrossTenantMutationGuardApiTests"`
Expected: PASS. (If it fails because tenant B's mutation succeeded, the guard is not wired — revisit Tasks 3–4.)

- [x] **Step 3: Commit**

```bash
git add src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/CrossTenantMutationGuardApiTests.cs
git commit -m "test(gis): US-X-01 cross-tenant mutation returns 404 end-to-end (US-X-01)"
```

---

## Task 6: asset-be — tenant-scoped overload on asset repository

**Files:**
- Modify: `src/services/water-network-asset-be/src/WaterNetwork.Asset.Domain/Repositories/INetworkAssetRepository.cs`
- Modify: `src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure/Repositories/NetworkAssetRepository.cs`
- Test: `src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/CrossTenantRepositoryTests.cs` (create)

- [x] **Step 1: Write the failing repository test**

Create `CrossTenantRepositoryTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Asset.IntegrationTests;

public class CrossTenantRepositoryTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    [Fact]
    public async Task AssetRepository_GetByIdAsync_TenantScoped_Returns_Null_For_Other_Tenant()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();

        var id = $"node-{Guid.CreateVersion7():N}";
        var asset = NetworkAsset.RegisterFromGis(id, "tenant-A", AssetType.Node, "ND-XT-1");
        await repo.SaveAsync(asset);

        (await repo.GetByIdAsync("tenant-A", id)).Should().NotBeNull();
        (await repo.GetByIdAsync("tenant-B", id)).Should().BeNull();
    }
}
```

- [x] **Step 2: Run — verify compile failure**

Run: `dotnet build src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/WaterNetwork.Asset.IntegrationTests.csproj`
Expected: FAIL — `INetworkAssetRepository` has no `GetByIdAsync(string, string)` overload.

- [x] **Step 3: Add overload to interface**

In `INetworkAssetRepository.cs`, add inside the interface:

```csharp
    Task<NetworkAsset?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default);
```

- [x] **Step 4: Implement the overload**

In `NetworkAssetRepository.cs`, add below the existing `GetByIdAsync(string id, ...)` override (mirror its `.Include(...)` chain):

```csharp
    public async Task<NetworkAsset?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)
    {
        var model = await dbContext.NetworkAssets
            .AsNoTracking()
            .Include(x => x.LifecycleEntries)
            .Include(x => x.TechnicalProfile)
            .FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        return model is null ? null : ToDomain(model);
    }
```

- [x] **Step 5: Run — verify pass**

Run: `dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/WaterNetwork.Asset.IntegrationTests.csproj --filter "FullyQualifiedName~CrossTenantRepositoryTests"`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/services/water-network-asset-be/src/WaterNetwork.Asset.Domain/Repositories/INetworkAssetRepository.cs \
        src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure/Repositories/NetworkAssetRepository.cs \
        src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/CrossTenantRepositoryTests.cs
git commit -m "feat(asset): US-X-01 tenant-scoped GetByIdAsync overload on asset repo (US-X-01)"
```

---

## Task 7: asset-be — five lifecycle handlers use tenant overload

All five handlers already resolve `tenant`. Change the one load line in each and update the shared unit test.

**Files:**
- Modify: `.../Commands/ActivateAssetCommandHandler.cs:17`, `SuspendAssetCommandHandler.cs:17`, `MarkAssetAsMaintenanceCommandHandler.cs:17`, `DecommissionAssetCommandHandler.cs:17`, `UpdateAssetTechnicalProfileCommandHandler.cs:17`
- Test: `.../WaterNetwork.Asset.UnitTests/Application/AssetLifecycleCommandHandlerTests.cs`

- [x] **Step 1: Update unit-test stubs + add cross-tenant test**

In `AssetLifecycleCommandHandlerTests.cs` the tenant is `"tenant-1"`. Replace every `_repo.GetByIdAsync("node-1", Arg.Any<CancellationToken>())` with `_repo.GetByIdAsync("tenant-1", "node-1", Arg.Any<CancellationToken>())` (occurrences on lines 33, 65, 75, 85, 96, 107) and `_repo.GetByIdAsync("nope", Arg.Any<CancellationToken>())` with `_repo.GetByIdAsync("tenant-1", "nope", Arg.Any<CancellationToken>())` (line 46).

Append a cross-tenant test:

```csharp
    [Fact]
    public async Task Command_On_Asset_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Save()
    {
        var asset = Active();
        // Stubbed only for a different tenant; caller is "tenant-1" → overload returns null.
        _repo.GetByIdAsync("tenant-999", "node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx);

        await handler.Invoking(h => h.HandleAsync(new SuspendAssetCommand("node-1", null), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
        await _repo.DidNotReceive().SaveAsync(Arg.Any<NetworkAsset>(), Arg.Any<CancellationToken>());
    }
```

- [x] **Step 2: Run — verify failure**

Run: `dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests/WaterNetwork.Asset.UnitTests.csproj --filter "FullyQualifiedName~AssetLifecycleCommandHandlerTests"`
Expected: FAIL — handlers still call the id-only overload, so tenant-scoped stubs don't match.

- [x] **Step 3: Update all five handlers**

In each of the five handler files, change line 17 from:

```csharp
        var asset = await repository.GetByIdAsync(command.AssetId, ct)
```

to:

```csharp
        var asset = await repository.GetByIdAsync(tenant.TenantId, command.AssetId, ct)
```

(The `?? throw NotFoundException.Entity(...)` continuation stays unchanged.)

- [x] **Step 4: Run — verify pass**

Run: `dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests/WaterNetwork.Asset.UnitTests.csproj --filter "FullyQualifiedName~AssetLifecycleCommandHandlerTests"`
Expected: PASS (all original tests + the cross-tenant test).

- [x] **Step 5: Commit**

```bash
git add src/services/water-network-asset-be/src/WaterNetwork.Asset.Application/Commands/ActivateAssetCommandHandler.cs \
        src/services/water-network-asset-be/src/WaterNetwork.Asset.Application/Commands/SuspendAssetCommandHandler.cs \
        src/services/water-network-asset-be/src/WaterNetwork.Asset.Application/Commands/MarkAssetAsMaintenanceCommandHandler.cs \
        src/services/water-network-asset-be/src/WaterNetwork.Asset.Application/Commands/DecommissionAssetCommandHandler.cs \
        src/services/water-network-asset-be/src/WaterNetwork.Asset.Application/Commands/UpdateAssetTechnicalProfileCommandHandler.cs \
        src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests/Application/AssetLifecycleCommandHandlerTests.cs
git commit -m "feat(asset): US-X-01 lifecycle handlers load asset tenant-scoped (US-X-01)"
```

---

## Task 8: asset-be — cross-tenant API integration test

**Files:**
- Test: `.../WaterNetwork.Asset.IntegrationTests/CrossTenantMutationGuardApiTests.cs` (create)

- [x] **Step 1: Write the integration test**

Create `CrossTenantMutationGuardApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Application.Dtos;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Asset.IntegrationTests;

public class CrossTenantMutationGuardApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static HttpClient ClientFor(AssetApiFactory factory, string tenantId)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(
            new JwtOptions(), subject: "test-user", tenantId: tenantId,
            permissions: new[] { "network-asset:write", "network-asset:read" });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> SeedAssetAsync(AssetApiFactory factory, string tenantId)
    {
        var id = $"node-{Guid.CreateVersion7():N}";
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var asset = NetworkAsset.RegisterFromGis(id, tenantId, AssetType.Node, $"ND-{id[^8..]}");
        await repo.SaveAsync(asset);
        return id;
    }

    [Fact]
    public async Task Tenant_B_Cannot_Mutate_Tenant_A_Asset()
    {
        await using var factory = new AssetApiFactory(postgis);
        using var tenantA = ClientFor(factory, "tenant-A");
        using var tenantB = ClientFor(factory, "tenant-B");

        var id = await SeedAssetAsync(factory, "tenant-A");

        // Every tenant-B mutation → 404.
        (await tenantB.PostAsync($"/api/assets/{id}/suspend", null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await tenantB.PostAsJsonAsync($"/api/assets/{id}/decommission", new { reason = "x" }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await tenantB.PutAsJsonAsync($"/api/assets/{id}/technical-profile",
            new { installationYear = 2000, manufacturer = "X", model = "Y", attributes = new Dictionary<string, string?>() }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        // Unchanged: tenant A still sees the asset as Active with only the creation entry.
        var getA = await tenantA.GetAsync($"/api/assets/{id}");
        getA.StatusCode.Should().Be(HttpStatusCode.OK);
        var detail = await getA.Content.ReadFromJsonAsync<AssetDetailDto>();
        detail!.Status.Should().Be("Active");
        detail.LifecycleHistory.Should().HaveCount(1, "only Registered→Active from creation; no tenant-B mutation applied");

        // Control: tenant A (owner) can suspend its own asset.
        (await tenantA.PostAsync($"/api/assets/{id}/suspend", null)).StatusCode.Should().Be(HttpStatusCode.NoContent);
    }
}
```

- [x] **Step 2: Run — verify pass**

Run: `dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/WaterNetwork.Asset.IntegrationTests.csproj --filter "FullyQualifiedName~CrossTenantMutationGuardApiTests"`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/CrossTenantMutationGuardApiTests.cs
git commit -m "test(asset): US-X-01 cross-tenant mutation returns 404 end-to-end (US-X-01)"
```

---

## Task 9: Decision record, backlog update, and full verification

**Files:**
- Create: `docs/decisions/0016-cross-tenant-mutation-guard.md`
- Modify: `docs/stories/backlog.md`

- [x] **Step 1: Write the decision record**

Create `docs/decisions/0016-cross-tenant-mutation-guard.md`:

```markdown
# 0016 — Cross-Tenant Mutation Guard (US-X-01)

**Status:** Accepted — 2026-06-17
**Context:** Security (multi-tenancy)

## Decision

Mutation command handlers in gis-be and asset-be loaded aggregates by id only,
so a caller in tenant B who knew an id owned by tenant A could mutate it. We add
a per-interface overload `GetByIdAsync(string tenantId, string id, ct)` that
filters `WHERE id = @id AND tenant_id = @tenantId`. Load-then-mutate handlers
call it with the caller's `tenant.TenantId`; a mismatch returns null and the
existing `?? throw NotFoundException` yields **404** (not 403 — avoids
id-enumeration).

## Why an overload, not a base-contract change

`IAggregateRepository<T>` is extended by asset-be and design-be repos, and in
gis-be the id-only `GetByIdAsync` is shared with `RegisterPipe`/`InstallDevice`
reference lookups (scope b, deferred). Changing the base signature would force
~10 design-be call sites (incl. two event consumers) to thread a tenant and
would silently activate reference guard (b). The overload contains the change to
scope (a). It follows the existing `IDraftNetworkAssetRepository.GetByIdAsync(tenantId, id)`
precedent.

## Consequences

- The id-only `GetByIdAsync(id)` still exists (used by reference lookups and
  consumers), so a future load-then-mutate handler could call the wrong overload.
  Mitigated by per-service cross-tenant integration tests; revisit with a
  base-contract or analyzer guard if a third service repeats the pattern.
- Reference guard (b) and design-be remain out of scope (deferred).
- `DeleteAsync(id)` is unchanged: the handler's tenant-scoped load 404s before
  any delete, and the delete re-loads the same globally-unique row.
```

- [x] **Step 2: Update the backlog**

In `docs/stories/backlog.md`, under "Follow-up sau AST-2 Lifecycle commands", replace the `⚠️ Cross-tenant mutation guard` bullet's leading marker so it reads as resolved, appending:

```
  **— RESOLVED (US-X-01, decision 0016):** mutation handlers (asset 5 lifecycle + gis Relocate/Remove node·pipe·device) now load via tenant-scoped `GetByIdAsync(tenantId, id)` → cross-tenant id 404s. Reference guard (b) on endpoint/host refs still deferred.
```

Also under "Follow-up sau GIS-3", append to the `Tenant check trên endpoint/host refs` bullet: `Mutation-on-load guard RESOLVED in US-X-01 (decision 0016); endpoint/host *reference* guard still deferred.`

- [x] **Step 3: Full verification — run all four test projects**

Run (Docker must be up for the integration projects):

```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.UnitTests/WaterNetwork.Gis.UnitTests.csproj
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.UnitTests/WaterNetwork.Asset.UnitTests.csproj
dotnet test src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/WaterNetwork.Asset.IntegrationTests.csproj
```

Expected: all PASS, **0 warnings** (`TreatWarningsAsErrors=true` fails the build on any warning).

- [x] **Step 4: Commit**

```bash
git add docs/decisions/0016-cross-tenant-mutation-guard.md docs/stories/backlog.md
git commit -m "docs(security): US-X-01 decision 0016 + backlog update (US-X-01)"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Tasks 1–2 + 6 = tenant-scoped overload (spec §2/§3). Tasks 3–4 + 7 = handlers use it (spec §3). Tasks 5 + 8 = "tenant A invisible to tenant B" integration tests with DB-unchanged assertions (spec §4). Task 9 = decision record + DoD (spec §6).
- **Out of scope honored:** no edits to building-blocks `IAggregateRepository<T>`, design-be, `RegisterPipe`/`InstallDevice` reference lookups, `DeleteAsync`, or read DAOs.
- **Overload disambiguation:** `GetByIdAsync(id, ct)` (2 args) vs `GetByIdAsync(tenantId, id, ct)` (3 args) differ by arity → no call-site ambiguity. Existing reference-lookup and consumer calls keep resolving to the 2-arg method.
- **Type consistency:** the overload signature `Task<T?> GetByIdAsync(string tenantId, string id, CancellationToken ct = default)` is identical across all four interfaces and implementations.
```
