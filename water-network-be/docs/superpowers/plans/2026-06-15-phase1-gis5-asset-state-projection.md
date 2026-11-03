# GIS-5 Projection `network_asset_states` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GIS dựng projection cục bộ `network_asset_states` từ event `asset.registered` + `asset.status.changed`, để bbox query trả `lifecycleStatus` thật.

**Architecture:** Consumer envelope idempotent (qua inbox) → derive tenant từ bảng GIS cục bộ (envelope tenant null cho outbox event) → upsert projection có OccurredAt guard chống regress → bbox `LEFT JOIN` projection. Trích `IdempotentEnvelopeConsumer` base class lên building-blocks, refactor cả asset-be.

**Tech Stack:** .NET 10, EF Core (migration + model), Dapper (upsert + read), MassTransit (consumer), xUnit + FluentAssertions + Testcontainers (PostgisFixture).

**Spec:** `docs/superpowers/specs/2026-06-15-gis5-asset-state-projection-design.md`

---

## File Structure

**Building blocks (mới):**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.EventBus/Integration/IdempotentEnvelopeConsumer.cs` — base class envelope-consumer (filter EventType + inbox dedup + core broker-free).

**asset-be (refactor):**
- Modify: `src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure/Consumers/GisAssetRegistrationConsumer.cs` — kế thừa base.

**gis-be (mới + modify):**
- Create: `.../WaterNetwork.Gis.Infrastructure/Persistence/AssetStatePersistenceModel.cs`
- Create: `.../WaterNetwork.Gis.Infrastructure/Persistence/Configurations/AssetStateConfiguration.cs`
- Modify: `.../WaterNetwork.Gis.Infrastructure/Persistence/GisDbContext.cs` — thêm DbSet.
- Create: migration `.../Persistence/Migrations/*_AddNetworkAssetStates.cs` (sinh bằng `dotnet ef`).
- Create: `.../WaterNetwork.Gis.Application/Ports/IAssetStateProjectionStore.cs`
- Create: `.../WaterNetwork.Gis.Infrastructure/Repositories/AssetStateProjectionStore.cs`
- Create: `.../WaterNetwork.Gis.Application/Ports/IAssetTenantLookupDao.cs`
- Create: `.../WaterNetwork.Gis.Infrastructure/Repositories/AssetTenantLookupDao.cs`
- Create: `.../WaterNetwork.Gis.Infrastructure/Consumers/AssetLifecycleProjectionConsumer.cs`
- Modify: `.../WaterNetwork.Gis.Infrastructure/WaterNetwork.Gis.Infrastructure.csproj` — ProjectReference tới `WaterNetwork.Asset.Contracts`.
- Modify: `.../WaterNetwork.Gis.Infrastructure/Repositories/BboxAssetReadDao.cs` — LEFT JOIN projection.
- Modify: `.../WaterNetwork.Gis.Application/Ports/IBboxAssetReadDao.cs` — thêm `LifecycleStatus` vào `BboxAssetRow`.
- Modify: `.../WaterNetwork.Gis.Application/Queries/GetAssetsInBboxQueryHandler.cs` — map `LifecycleStatus` từ row.
- Modify: `.../WaterNetwork.Gis.Api/Program.cs` — wiring consumer + DI.

**Tests:**
- Modify: `.../tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj` — ProjectReference `WaterNetwork.Asset.Contracts`.
- Modify: `.../tests/WaterNetwork.Gis.ContractTests/WaterNetwork.Gis.ContractTests.csproj` — ProjectReference `WaterNetwork.Asset.Contracts`.
- Create: `.../tests/WaterNetwork.Gis.IntegrationTests/AssetStateProjectionStoreTests.cs`
- Create: `.../tests/WaterNetwork.Gis.IntegrationTests/AssetLifecycleProjectionConsumerTests.cs`
- Create: `.../tests/WaterNetwork.Gis.ContractTests/AssetLifecycleConsumerContractTests.cs`
- Modify: `.../tests/WaterNetwork.Gis.IntegrationTests/GetAssetsInBboxApiTests.cs` — thêm test lifecycleStatus populated.

**Docs:**
- Create: `docs/decisions/0013-gis-asset-state-projection.md`
- Modify: `docs/conventions/event-catalog.md`, `docs/conventions/template-mapping.md`, roadmap (tick), `docs/stories/backlog.md`.

---

## Task 1: Promote `IdempotentEnvelopeConsumer` base class

**Files:**
- Create: `src/building-blocks/src/WaterPlatform.BuildingBlocks.EventBus/Integration/IdempotentEnvelopeConsumer.cs`
- Modify: `src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure/Consumers/GisAssetRegistrationConsumer.cs`
- Test (regression): `src/services/water-network-asset-be/tests/WaterNetwork.Asset.IntegrationTests/GisAssetRegistrationConsumerTests.cs` (không sửa — phải vẫn xanh)

- [ ] **Step 1: Tạo base class**

Create `IdempotentEnvelopeConsumer.cs`:

```csharp
using MassTransit;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterPlatform.BuildingBlocks.EventBus.Integration;

/// <summary>
/// Base for consumers of the platform <see cref="IntegrationEventEnvelope"/>. Filters by
/// <see cref="IntegrationEventEnvelope.EventType"/>, deduplicates via the inbox, and exposes a
/// broker-free core (<see cref="HandleAsync"/>) so behaviour is integration-testable without MassTransit.
/// </summary>
/// <remarks>
/// If <see cref="HandleAsync"/> throws, the message is NOT marked processed — a redelivery retries.
/// </remarks>
public abstract class IdempotentEnvelopeConsumer(IInboxMessageStore inbox)
    : IConsumer<IntegrationEventEnvelope>
{
    protected abstract string ConsumerName { get; }

    /// <summary>True for the EventTypes this consumer handles; others are ignored.</summary>
    protected abstract bool Subscribes(string eventType);

    public Task Consume(ConsumeContext<IntegrationEventEnvelope> context)
        => HandleEnvelopeAsync(context.Message, context.CancellationToken);

    /// <summary>Broker-free core: filter → inbox dedup → handle → mark processed.</summary>
    public async Task HandleEnvelopeAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        if (!Subscribes(envelope.EventType)) return;
        if (await inbox.HasBeenProcessedAsync(ConsumerName, envelope.EventId, ct)) return;

        await HandleAsync(envelope, ct);

        await inbox.MarkAsProcessedAsync(ConsumerName, envelope.EventId, ct);
    }

    protected abstract Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct);
}
```

- [ ] **Step 2: Refactor `GisAssetRegistrationConsumer` lên base**

Thay phần đầu file (class declaration + `Consume`/`HandleEnvelopeAsync`) bằng override, giữ nguyên `ExtractIdentity`/`Read`/`IsUniqueViolation`/`LogAssetAlreadyCreated`. File mới:

```csharp
using System.Text.Json;
using Microsoft.Extensions.Logging;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Asset.Infrastructure.Consumers;

/// <summary>
/// Consumes GIS registration events and materialises an asset profile for each.
/// First consumer in the platform — see decision 0011.
/// </summary>
public sealed partial class GisAssetRegistrationConsumer(
    INetworkAssetRepository repository,
    IInboxMessageStore inbox,
    ILogger<GisAssetRegistrationConsumer> logger)
    : IdempotentEnvelopeConsumer(inbox)
{
    protected override string ConsumerName => "asset.gis-registration";

    protected override bool Subscribes(string eventType)
        => AssetTypeMapping.FromGisEventType(eventType) is not null;

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Asset {AssetId} already created by a concurrent consumer; continuing.")]
    private static partial void LogAssetAlreadyCreated(ILogger logger, string assetId, Exception ex);

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        var assetType = AssetTypeMapping.FromGisEventType(envelope.EventType)!.Value;
        var (assetId, tenantId, assetCode) = ExtractIdentity(envelope, assetType);

        // PK == GIS id → natural idempotency. Pre-check avoids a guaranteed unique-violation on redelivery.
        if (!await repository.ExistsAsync(assetId, ct))
        {
            try
            {
                await repository.SaveAsync(
                    NetworkAsset.RegisterFromGis(assetId, tenantId, assetType, assetCode), ct);
            }
            catch (Exception ex) when (IsUniqueViolation(ex))
            {
                // A unique violation is only an idempotent no-op when THIS asset (same id) already exists
                // (a concurrent redelivery won the insert race). If the row for this assetId still does not
                // exist, the violation was a *different* asset colliding on (tenant_id, asset_code) — that is
                // a real conflict that must surface (retry/dead-letter), not be silently dropped.
                if (!await repository.ExistsAsync(assetId, ct))
                    throw;

                LogAssetAlreadyCreated(logger, assetId, ex);
            }
        }
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
            if (e is Npgsql.PostgresException { SqlState: "23505" })
                return true;
        return false;
    }
}
```

- [ ] **Step 3: Build + chạy asset-be tests (regression — base class không đổi hành vi)**

Run:
```bash
dotnet test src/services/water-network-asset-be/WaterNetwork.Asset.slnx
```
Expected: PASS toàn bộ (đặc biệt `GisAssetRegistrationConsumerTests`: Creates_Profile, Ignores_Unsubscribed, Deliver_Twice, Different_Asset_Colliding). 0 warning.

- [ ] **Step 4: Build building-blocks solution**

Run:
```bash
dotnet build WaterPlatform.BuildingBlocks.slnx
```
Expected: Build succeeded, 0 warning.

- [ ] **Step 5: Commit**

```bash
git add src/building-blocks/src/WaterPlatform.BuildingBlocks.EventBus/Integration/IdempotentEnvelopeConsumer.cs \
        src/services/water-network-asset-be/src/WaterNetwork.Asset.Infrastructure/Consumers/GisAssetRegistrationConsumer.cs
git commit -m "refactor(eventbus): promote IdempotentEnvelopeConsumer base class

Extract envelope filter + inbox dedup + broker-free core into a building-block
base; refactor asset-be GisAssetRegistrationConsumer onto it. Prepares GIS-5
projection consumer (2nd consumer in platform).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration M5 — `network_asset_states`

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Persistence/AssetStatePersistenceModel.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Persistence/Configurations/AssetStateConfiguration.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Persistence/GisDbContext.cs`
- Create: migration (sinh bằng EF tooling)

- [ ] **Step 1: Tạo persistence model**

Create `AssetStatePersistenceModel.cs`:

```csharp
namespace WaterNetwork.Gis.Infrastructure.Persistence;

/// <summary>
/// Local read-model row: lifecycle status of an asset (owned by asset-be) projected into GIS.
/// asset_id == GIS asset id (decision #2). No soft-delete, no aggregate — pure projection.
/// </summary>
public sealed class AssetStatePersistenceModel
{
    public string AssetId { get; set; } = default!;
    public string TenantId { get; set; } = default!;
    public string LifecycleStatus { get; set; } = default!;
    public DateTime UpdatedAt { get; set; }
    public string LastEventId { get; set; } = default!;
}
```

- [ ] **Step 2: Tạo EF configuration**

Create `Configurations/AssetStateConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class AssetStateConfiguration : IEntityTypeConfiguration<AssetStatePersistenceModel>
{
    public void Configure(EntityTypeBuilder<AssetStatePersistenceModel> builder)
    {
        builder.ToTable("network_asset_states");
        builder.HasKey(x => x.AssetId);
        builder.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.LifecycleStatus).HasColumnName("lifecycle_status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.Property(x => x.LastEventId).HasColumnName("last_event_id").HasMaxLength(64).IsRequired();

        builder.HasIndex(x => x.TenantId).HasDatabaseName("ix_asset_states_tenant");

        // No HasQueryFilter: projection has no soft-delete; bbox joins it explicitly.
    }
}
```

- [ ] **Step 3: Thêm DbSet vào GisDbContext**

Modify `GisDbContext.cs` — thêm dòng sau `GeometryVersions`:

```csharp
    public DbSet<AssetStatePersistenceModel> NetworkAssetStates => Set<AssetStatePersistenceModel>();
```

(Config tự nạp qua `ApplyConfigurationsFromAssembly` đã có.)

- [ ] **Step 4: Sinh migration**

Run:
```bash
dotnet ef migrations add AddNetworkAssetStates \
  --project src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure \
  --startup-project src/services/water-network-gis-be/src/WaterNetwork.Gis.Api \
  --output-dir Persistence/Migrations
```
Expected: tạo `*_AddNetworkAssetStates.cs` + `.Designer.cs`, cập nhật `GisDbContextModelSnapshot.cs`. Migration `CreateTable("network_asset_states")` + `ix_asset_states_tenant`.

- [ ] **Step 5: Verify migration nội dung**

Mở file migration mới, xác nhận `migrationBuilder.CreateTable(name: "network_asset_states", ...)` có cột `asset_id` (PK), `tenant_id`, `lifecycle_status`, `updated_at`, `last_event_id` và `CreateIndex("ix_asset_states_tenant")`. Không có cột thừa.

- [ ] **Step 6: Build**

Run:
```bash
dotnet build src/services/water-network-gis-be/WaterNetwork.Gis.slnx
```
Expected: Build succeeded, 0 warning.

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Persistence/
git commit -m "feat(gis): network_asset_states projection table (M5, GIS-5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Projection store (Dapper guarded upsert)

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IAssetStateProjectionStore.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/AssetStateProjectionStore.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/AssetStateProjectionStoreTests.cs`

> Store dùng raw SQL `ON CONFLICT ... WHERE` (EF không biểu diễn được) → test cần Postgres thật → đặt ở IntegrationTests.

- [ ] **Step 1: Tạo port**

Create `IAssetStateProjectionStore.cs`:

```csharp
namespace WaterNetwork.Gis.Application.Ports;

public interface IAssetStateProjectionStore
{
    /// <summary>
    /// Upserts the lifecycle status of an asset. Guarded by <paramref name="occurredAt"/>:
    /// an event older than the stored row is ignored, so reordered deliveries never regress status.
    /// </summary>
    Task UpsertAsync(string assetId, string tenantId, string lifecycleStatus,
        DateTime occurredAt, string lastEventId, CancellationToken ct = default);
}
```

- [ ] **Step 2: Viết failing test**

Create `AssetStateProjectionStoreTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class AssetStateProjectionStoreTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static async Task<(GisApiFactory f, IServiceScope s)> BootAsync(PostgisFixture postgis)
    {
        var f = new GisApiFactory(postgis);
        var s = f.Services.CreateScope();
        return (f, s);
    }

    [Fact]
    public async Task Upsert_Inserts_Then_Updates_With_Newer_OccurredAt()
    {
        var (f, scope) = await BootAsync(postgis);
        await using var _ = f; using var __ = scope;
        var store = scope.ServiceProvider.GetRequiredService<IAssetStateProjectionStore>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var id = $"asset-{Guid.NewGuid():N}";
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        await store.UpsertAsync(id, "tenant-1", "Active", t0, "evt-1");
        await store.UpsertAsync(id, "tenant-1", "Suspended", t0.AddMinutes(5), "evt-2");

        var row = await db.NetworkAssetStates.FindAsync(id);
        row!.LifecycleStatus.Should().Be("Suspended");
        row.LastEventId.Should().Be("evt-2");
    }

    [Fact]
    public async Task Upsert_With_Older_OccurredAt_Does_Not_Regress()
    {
        var (f, scope) = await BootAsync(postgis);
        await using var _ = f; using var __ = scope;
        var store = scope.ServiceProvider.GetRequiredService<IAssetStateProjectionStore>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var id = $"asset-{Guid.NewGuid():N}";
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        await store.UpsertAsync(id, "tenant-1", "Suspended", t0.AddMinutes(5), "evt-new");
        await store.UpsertAsync(id, "tenant-1", "Active", t0, "evt-old"); // older — must be ignored

        var row = await db.NetworkAssetStates.FindAsync(id);
        row!.LifecycleStatus.Should().Be("Suspended", "an older event must not regress the projection");
        row.LastEventId.Should().Be("evt-new");
    }
}
```

- [ ] **Step 3: Chạy test → fail (chưa có impl)**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter AssetStateProjectionStoreTests
```
Expected: FAIL biên dịch — `IAssetStateProjectionStore` chưa có DI registration / impl.

- [ ] **Step 4: Viết impl**

Create `AssetStateProjectionStore.cs`:

```csharp
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

/// <summary>
/// Dapper upsert into network_asset_states with an OccurredAt ordering guard: the WHERE clause on
/// the ON CONFLICT branch drops the write when the incoming event is older than the stored row,
/// so at-least-once redelivery and event reordering never regress lifecycle status.
/// </summary>
public sealed class AssetStateProjectionStore(GisDbContext dbContext) : IAssetStateProjectionStore
{
    private const string UpsertSql = """
        INSERT INTO network_asset_states (asset_id, tenant_id, lifecycle_status, updated_at, last_event_id)
        VALUES (@assetId, @tenantId, @lifecycleStatus, @updatedAt, @lastEventId)
        ON CONFLICT (asset_id) DO UPDATE
          SET lifecycle_status = excluded.lifecycle_status,
              updated_at       = excluded.updated_at,
              last_event_id    = excluded.last_event_id
          WHERE excluded.updated_at >= network_asset_states.updated_at;
        """;

    public async Task UpsertAsync(string assetId, string tenantId, string lifecycleStatus,
        DateTime occurredAt, string lastEventId, CancellationToken ct = default)
    {
        var connection = dbContext.Database.GetDbConnection();
        await connection.ExecuteAsync(new CommandDefinition(UpsertSql, new
        {
            assetId,
            tenantId,
            lifecycleStatus,
            updatedAt = occurredAt,
            lastEventId
        }, cancellationToken: ct));
    }
}
```

- [ ] **Step 5: Đăng ký DI trong Program.cs**

Modify `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs` — thêm sau `AddScoped<IBboxAssetReadDao, BboxAssetReadDao>();`:

```csharp
builder.Services.AddScoped<IAssetStateProjectionStore, AssetStateProjectionStore>();
```

- [ ] **Step 6: Chạy test → pass**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter AssetStateProjectionStoreTests
```
Expected: PASS (2 test).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IAssetStateProjectionStore.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/AssetStateProjectionStore.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/AssetStateProjectionStoreTests.cs
git commit -m "feat(gis): asset-state projection store with OccurredAt guard (GIS-5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Asset tenant lookup DAO

**Files:**
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IAssetTenantLookupDao.cs`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/AssetTenantLookupDao.cs`
- Test: `AssetStateProjectionStoreTests.cs` (thêm test) hoặc trong consumer test (Task 5). Ở đây thêm test nhỏ riêng.

- [ ] **Step 1: Tạo port**

Create `IAssetTenantLookupDao.cs`:

```csharp
namespace WaterNetwork.Gis.Application.Ports;

public interface IAssetTenantLookupDao
{
    /// <summary>
    /// Resolves the owning tenant of a GIS asset by its id and kind (Node|Pipe|Device).
    /// Returns null when no such asset row exists. Used by the lifecycle projection consumer because
    /// outbox-published envelopes carry no tenant and asset.status.changed has no tenant in its payload.
    /// </summary>
    Task<string?> GetTenantAsync(string assetId, string assetKind, CancellationToken ct = default);
}
```

- [ ] **Step 2: Viết failing test (thêm vào AssetStateProjectionStoreTests.cs)**

Thêm test sau vào class `AssetStateProjectionStoreTests` (cùng file, dùng GisApiFactory + register node qua API để có row thật):

```csharp
    [Fact]
    public async Task TenantLookup_Returns_Tenant_For_Registered_Node()
    {
        await using var f = new GisApiFactory(postgis);
        // Register a node via the real flow so a network_nodes row exists with tenant from the JWT.
        var client = f.CreateClient();
        var token = WaterPlatform.BuildingBlocks.Security.DevJwtTokenFactory.CreateToken(
            new WaterPlatform.BuildingBlocks.Security.JwtOptions(),
            subject: "u", tenantId: "tenant-lookup", permissions: ["network-gis:write"]);
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        var resp = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = 10.76, longitude = 106.66
        });
        var nodeId = (await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetString()!;

        using var scope = f.Services.CreateScope();
        var dao = scope.ServiceProvider.GetRequiredService<IAssetTenantLookupDao>();

        (await dao.GetTenantAsync(nodeId, "Node")).Should().Be("tenant-lookup");
        (await dao.GetTenantAsync($"missing-{Guid.NewGuid():N}", "Node")).Should().BeNull();
    }
```

Thêm `using System.Net.Http.Json;` và `using System.Net.Http.Headers;` vào đầu file nếu chưa có.

- [ ] **Step 3: Chạy → fail**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter TenantLookup_Returns_Tenant_For_Registered_Node
```
Expected: FAIL biên dịch (`IAssetTenantLookupDao` chưa register/impl).

- [ ] **Step 4: Viết impl**

Create `AssetTenantLookupDao.cs`:

```csharp
using Dapper;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Infrastructure.Persistence;

namespace WaterNetwork.Gis.Infrastructure.Repositories;

public sealed class AssetTenantLookupDao(GisDbContext dbContext) : IAssetTenantLookupDao
{
    public async Task<string?> GetTenantAsync(string assetId, string assetKind, CancellationToken ct = default)
    {
        // Table name is whitelisted from a closed set — never interpolated from external input.
        var table = assetKind switch
        {
            "Node" => "network_nodes",
            "Pipe" => "network_pipes",
            "Device" => "network_devices",
            _ => throw new ArgumentOutOfRangeException(nameof(assetKind), assetKind, "Unknown asset kind.")
        };
        var sql = $"SELECT tenant_id FROM {table} WHERE id = @assetId";
        var connection = dbContext.Database.GetDbConnection();
        return await connection.ExecuteScalarAsync<string?>(
            new CommandDefinition(sql, new { assetId }, cancellationToken: ct));
    }
}
```

- [ ] **Step 5: Đăng ký DI**

Modify `Program.cs` — thêm sau `AddScoped<IAssetStateProjectionStore, ...>`:

```csharp
builder.Services.AddScoped<IAssetTenantLookupDao, AssetTenantLookupDao>();
```

- [ ] **Step 6: Chạy → pass**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter TenantLookup_Returns_Tenant_For_Registered_Node
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IAssetTenantLookupDao.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/AssetTenantLookupDao.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/AssetStateProjectionStoreTests.cs
git commit -m "feat(gis): asset tenant lookup DAO for projection consumer (GIS-5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `AssetLifecycleProjectionConsumer` + wiring

**Files:**
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/WaterNetwork.Gis.Infrastructure.csproj`
- Create: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Consumers/AssetLifecycleProjectionConsumer.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs`
- Modify: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/AssetLifecycleProjectionConsumerTests.cs`

- [ ] **Step 1: Thêm ProjectReference asset Contracts vào gis Infrastructure**

Modify `WaterNetwork.Gis.Infrastructure.csproj` — thêm vào `<ItemGroup>` ProjectReference đầu tiên:

```xml
    <ProjectReference Include="../../../water-network-asset-be/src/WaterNetwork.Asset.Contracts/WaterNetwork.Asset.Contracts.csproj" />
```

- [ ] **Step 2: Thêm ProjectReference asset Contracts vào IntegrationTests**

Modify `WaterNetwork.Gis.IntegrationTests.csproj` — thêm trong `<ItemGroup>` ProjectReference:

```xml
    <ProjectReference Include="../../../../water-network-asset-be/src/WaterNetwork.Asset.Contracts/WaterNetwork.Asset.Contracts.csproj" />
```

> Lưu ý độ sâu thư mục test (`tests/<Project>/`) → 4 cấp `../` tới `src/services`. Verify lại bằng `ls` nếu build không thấy project.

- [ ] **Step 3: Viết failing test**

Create `AssetLifecycleProjectionConsumerTests.cs`:

```csharp
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class AssetLifecycleProjectionConsumerTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    // The integration-event payload shape: { ..., "Data": <V1> }. Mirrors how the outbox publishes.
    private static IntegrationEventEnvelope Envelope(string eventId, string eventType, DateTime occurredAt, object data) =>
        new(eventId, eventType, 1, occurredAt, null, null, null, null, null,
            "water-network-asset-be",
            JsonSerializer.Serialize(new
            {
                EventId = eventId, EventType = eventType, EventVersion = 1, OccurredAt = occurredAt,
                SourceAggregateId = "x", SourceAggregateType = "NetworkAsset", Data = data
            }));

    private static async Task<(GisApiFactory f, string nodeId)> BootWithNode(PostgisFixture postgis, string tenantId)
    {
        var f = new GisApiFactory(postgis);
        var client = f.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(),
            subject: "u", tenantId: tenantId, permissions: ["network-gis:write", "network-gis:read"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var resp = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = 10.765, longitude = 106.66
        });
        var nodeId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
        return (f, nodeId);
    }

    [Fact]
    public async Task Registered_Then_StatusChanged_Projects_Latest_Status()
    {
        var (f, nodeId) = await BootWithNode(postgis, "tenant-proj");
        await using var _ = f;
        using var scope = f.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<AssetLifecycleProjectionConsumer>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        await consumer.HandleEnvelopeAsync(Envelope(
            Guid.NewGuid().ToString(), AssetEventTypes.AssetRegistered, t0,
            new AssetRegisteredV1(nodeId, "tenant-proj", "Node", "ND-x", "Active")), default);

        (await db.NetworkAssetStates.FindAsync(nodeId))!.LifecycleStatus.Should().Be("Active");

        await consumer.HandleEnvelopeAsync(Envelope(
            Guid.NewGuid().ToString(), AssetEventTypes.StatusChanged, t0.AddMinutes(5),
            new AssetStatusChangedV1(nodeId, "Node", "Active", "Suspended", "leak", "op-1")), default);

        db.ChangeTracker.Clear();
        (await db.NetworkAssetStates.FindAsync(nodeId))!.LifecycleStatus.Should().Be("Suspended");
    }

    [Fact]
    public async Task Deliver_Twice_Same_EventId_Applies_Once()
    {
        var (f, nodeId) = await BootWithNode(postgis, "tenant-proj");
        await using var _ = f;
        using var scope = f.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<AssetLifecycleProjectionConsumer>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);
        var eventId = Guid.NewGuid().ToString();
        var env = Envelope(eventId, AssetEventTypes.AssetRegistered, t0,
            new AssetRegisteredV1(nodeId, "tenant-proj", "Node", "ND-x", "Active"));

        await consumer.HandleEnvelopeAsync(env, default);
        await consumer.HandleEnvelopeAsync(env, default); // redelivery

        var inbox = scope.ServiceProvider.GetRequiredService<IInboxMessageStore>();
        (await inbox.HasBeenProcessedAsync("gis.asset-lifecycle-projection", eventId)).Should().BeTrue();
        (await db.NetworkAssetStates.CountAsync(x => x.AssetId == nodeId)).Should().Be(1);
    }

    [Fact]
    public async Task Out_Of_Order_Older_Status_Does_Not_Regress()
    {
        var (f, nodeId) = await BootWithNode(postgis, "tenant-proj");
        await using var _ = f;
        using var scope = f.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<AssetLifecycleProjectionConsumer>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var t0 = new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        await consumer.HandleEnvelopeAsync(Envelope(Guid.NewGuid().ToString(), AssetEventTypes.StatusChanged,
            t0.AddMinutes(5), new AssetStatusChangedV1(nodeId, "Node", "Active", "Suspended", null, "op")), default);
        await consumer.HandleEnvelopeAsync(Envelope(Guid.NewGuid().ToString(), AssetEventTypes.StatusChanged,
            t0, new AssetStatusChangedV1(nodeId, "Node", "Suspended", "Active", null, "op")), default); // older

        db.ChangeTracker.Clear();
        (await db.NetworkAssetStates.FindAsync(nodeId))!.LifecycleStatus.Should().Be("Suspended");
    }

    [Fact]
    public async Task Ignores_Unsubscribed_Event_Type()
    {
        var (f, nodeId) = await BootWithNode(postgis, "tenant-proj");
        await using var _ = f;
        using var scope = f.Services.CreateScope();
        var consumer = scope.ServiceProvider.GetRequiredService<AssetLifecycleProjectionConsumer>();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        var act = async () => await consumer.HandleEnvelopeAsync(Envelope(
            Guid.NewGuid().ToString(), "asset.technical-profile.updated",
            new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc), new { AssetId = nodeId }), default);

        await act.Should().NotThrowAsync();
        (await db.NetworkAssetStates.CountAsync(x => x.AssetId == nodeId)).Should().Be(0);
    }
}
```

- [ ] **Step 4: Chạy → fail**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter AssetLifecycleProjectionConsumerTests
```
Expected: FAIL biên dịch — `AssetLifecycleProjectionConsumer` chưa tồn tại.

- [ ] **Step 5: Viết consumer**

Create `Consumers/AssetLifecycleProjectionConsumer.cs`:

```csharp
using System.Text.Json;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Gis.Infrastructure.Consumers;

/// <summary>
/// Projects asset lifecycle status into the local network_asset_states read model — the first
/// consumer of water-network-gis-be. Subscribes to asset.registered (seeds the initial status,
/// since registration never emits status.changed) and asset.status.changed (every transition).
/// Tenant is derived from the local GIS asset row: outbox-published envelopes carry no tenant and
/// asset.status.changed has none in its payload (see spec decision #6).
/// </summary>
public sealed class AssetLifecycleProjectionConsumer(
    IAssetStateProjectionStore projection,
    IAssetTenantLookupDao tenantLookup,
    IInboxMessageStore inbox)
    : IdempotentEnvelopeConsumer(inbox)
{
    protected override string ConsumerName => "gis.asset-lifecycle-projection";

    protected override bool Subscribes(string eventType)
        => eventType is AssetEventTypes.AssetRegistered or AssetEventTypes.StatusChanged;

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var data = doc.RootElement.GetProperty("Data");

        var (assetId, assetKind, status) = envelope.EventType == AssetEventTypes.AssetRegistered
            ? Read(data.Deserialize<AssetRegisteredV1>(), d => (d.AssetId, d.AssetType, d.Status))
            : Read(data.Deserialize<AssetStatusChangedV1>(), d => (d.AssetId, d.AssetType, d.NewStatus));

        var tenantId = await tenantLookup.GetTenantAsync(assetId, assetKind, ct)
            ?? throw new InvalidOperationException(
                $"No GIS asset row for {assetKind} {assetId}; cannot resolve tenant for projection.");

        await projection.UpsertAsync(assetId, tenantId, status, envelope.OccurredAt, envelope.EventId, ct);
    }

    private static (string, string, string) Read<T>(T? data, Func<T, (string, string, string)> select)
        => data is null
            ? throw new InvalidOperationException($"Envelope payload Data did not deserialize to {typeof(T).Name}.")
            : select(data);
}
```

- [ ] **Step 6: Wiring trong Program.cs**

Modify `Program.cs`:

(a) Thêm `using WaterNetwork.Gis.Infrastructure.Consumers;` vào đầu file (cùng nhóm `using WaterNetwork.Gis.Infrastructure.*`).

(b) Thay dòng:
```csharp
builder.Services.AddPlatformEventBus(builder.Configuration);
```
bằng:
```csharp
builder.Services.AddScoped<AssetLifecycleProjectionConsumer>();
builder.Services.AddPlatformEventBus(builder.Configuration, bus =>
{
    bus.AddConsumer<AssetLifecycleProjectionConsumer>();
});
```

- [ ] **Step 7: Chạy → pass**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter AssetLifecycleProjectionConsumerTests
```
Expected: PASS (4 test).

- [ ] **Step 8: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Consumers/AssetLifecycleProjectionConsumer.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/WaterNetwork.Gis.Infrastructure.csproj \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Api/Program.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/WaterNetwork.Gis.IntegrationTests.csproj \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/AssetLifecycleProjectionConsumerTests.cs
git commit -m "feat(gis): asset lifecycle projection consumer (GIS-5)

Subscribes asset.registered + asset.status.changed; derives tenant from local
GIS asset row; idempotent via inbox; ordering-guarded upsert.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Consumer-side contract test

**Files:**
- Modify: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/WaterNetwork.Gis.ContractTests.csproj`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/AssetLifecycleConsumerContractTests.cs`

- [ ] **Step 1: Thêm ProjectReference asset Contracts vào ContractTests**

Modify `WaterNetwork.Gis.ContractTests.csproj` — thêm trong `<ItemGroup>` ProjectReference:

```xml
    <ProjectReference Include="../../../../water-network-asset-be/src/WaterNetwork.Asset.Contracts/WaterNetwork.Asset.Contracts.csproj" />
```

- [ ] **Step 2: Viết test**

Create `AssetLifecycleConsumerContractTests.cs`:

```csharp
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;
using Xunit;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Consumer-side contract: GIS-5 depends on these exact payload shapes + event-type constants.
/// If asset-be changes them, this test fails and forces a coordinated version bump.
/// </summary>
public class AssetLifecycleConsumerContractTests
{
    [Fact]
    public void EventTypes_Consumed_By_Gis_Are_Fixed()
    {
        AssetEventTypes.AssetRegistered.Should().Be("asset.registered");
        AssetEventTypes.StatusChanged.Should().Be("asset.status.changed");
    }

    [Fact]
    public void AssetRegisteredV1_Has_Fields_Gis_Reads()
    {
        var evt = new AssetRegisteredV1("a", "t", "Node", "ND-1", "Active");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Contain(["AssetId", "AssetType", "Status"]);
    }

    [Fact]
    public void AssetStatusChangedV1_Has_Fields_Gis_Reads()
    {
        var evt = new AssetStatusChangedV1("a", "Node", "Active", "Suspended", null, "op");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Contain(["AssetId", "AssetType", "NewStatus"]);
    }
}
```

- [ ] **Step 3: Chạy → pass**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests --filter AssetLifecycleConsumerContractTests
```
Expected: PASS (3 test).

- [ ] **Step 4: Commit**

```bash
git add src/services/water-network-gis-be/tests/WaterNetwork.Gis.ContractTests/
git commit -m "test(gis): consumer-side contract for asset lifecycle events (GIS-5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Bbox query — populate `lifecycleStatus`

**Files:**
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IBboxAssetReadDao.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/BboxAssetReadDao.cs`
- Modify: `src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/GetAssetsInBboxQueryHandler.cs`
- Test: `src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GetAssetsInBboxApiTests.cs`

- [ ] **Step 1: Thêm `LifecycleStatus` vào `BboxAssetRow`**

Modify `IBboxAssetReadDao.cs` — thêm field cuối record `BboxAssetRow`:

```csharp
    string? HostNodeId,
    string? LifecycleStatus);
```
(thay `string? HostNodeId);` cũ bằng 2 dòng trên — `LifecycleStatus` là field cuối.)

- [ ] **Step 2: Viết failing test (bbox trả lifecycleStatus)**

Thêm test vào `GetAssetsInBboxApiTests.cs`:

```csharp
    [Fact]
    public async Task Feature_LifecycleStatus_Is_Populated_From_Projection()
    {
        await using var factory = new GisApiFactory(postgis);
        var writer = Client(factory, "network-gis:write", "network-gis:read");

        // Seed a node, then project a lifecycle status for it (simulating the consumer).
        var resp = await writer.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-{Guid.NewGuid():N}"[..16], nodeType = "Junction", latitude = 10.765, longitude = 106.66
        });
        var nodeId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

        using (var scope = factory.Services.CreateScope())
        {
            var store = scope.ServiceProvider
                .GetRequiredService<WaterNetwork.Gis.Application.Ports.IAssetStateProjectionStore>();
            await store.UpsertAsync(nodeId, "tenant-api", "Suspended",
                new DateTime(2026, 6, 15, 10, 0, 0, DateTimeKind.Utc), "evt-1");
        }

        var json = await (await writer.GetAsync($"/api/network/assets?bbox={InsideBbox}&types=node"))
            .Content.ReadFromJsonAsync<JsonElement>();

        var feature = json.GetProperty("features").EnumerateArray()
            .First(x => x.GetProperty("id").GetString() == nodeId);
        feature.GetProperty("properties").GetProperty("lifecycleStatus").GetString().Should().Be("Suspended");
    }
```

Thêm `using Microsoft.Extensions.DependencyInjection;` và `using System.Linq;` vào đầu file nếu chưa có.

- [ ] **Step 3: Chạy → fail**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter Feature_LifecycleStatus_Is_Populated_From_Projection
```
Expected: FAIL — `lifecycleStatus` vẫn `null` (DAO chưa join, handler hardcode null) → cũng có thể fail biên dịch nếu `BboxAssetRow` thêm field nhưng DAO chưa fill (xem Step 4–5).

- [ ] **Step 4: Cập nhật DAO — LEFT JOIN projection cho cả 3 nhánh**

Modify `BboxAssetReadDao.cs`. Mỗi `*Select` thêm cột `LifecycleStatus` và `LEFT JOIN`. Thay 3 const string:

`NodeSelect`:
```csharp
    private const string NodeSelect = """
        SELECT 'Node'                  AS Kind,
               n.id                    AS Id,
               n.asset_code            AS AssetCode,
               'Active'                AS Status,
               ST_AsGeoJSON(n.location) AS GeoJson,
               n.node_type             AS NodeType,
               NULL::int               AS DiameterMm,
               NULL::text              AS Material,
               NULL::double precision  AS LengthM,
               NULL::text              AS FromNodeId,
               NULL::text              AS ToNodeId,
               NULL::text              AS DeviceType,
               NULL::text              AS HostPipeId,
               NULL::text              AS HostNodeId,
               s.lifecycle_status      AS LifecycleStatus
        FROM network_nodes n
        LEFT JOIN network_asset_states s ON s.asset_id = n.id AND s.tenant_id = @tenantId
        WHERE n.tenant_id = @tenantId AND n.deleted_at IS NULL
          AND n.location && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;
```

`PipeSelect`:
```csharp
    private const string PipeSelect = """
        SELECT 'Pipe'                  AS Kind,
               p.id                    AS Id,
               p.asset_code            AS AssetCode,
               p.status                AS Status,
               ST_AsGeoJSON(p.geometry) AS GeoJson,
               NULL::text              AS NodeType,
               p.diameter_mm           AS DiameterMm,
               p.material              AS Material,
               p.length_m              AS LengthM,
               p.from_node_id          AS FromNodeId,
               p.to_node_id            AS ToNodeId,
               NULL::text              AS DeviceType,
               NULL::text              AS HostPipeId,
               NULL::text              AS HostNodeId,
               s.lifecycle_status      AS LifecycleStatus
        FROM network_pipes p
        LEFT JOIN network_asset_states s ON s.asset_id = p.id AND s.tenant_id = @tenantId
        WHERE p.tenant_id = @tenantId AND p.deleted_at IS NULL
          AND p.geometry && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;
```

`DeviceSelect`:
```csharp
    private const string DeviceSelect = """
        SELECT 'Device'                AS Kind,
               d.id                    AS Id,
               d.asset_code            AS AssetCode,
               d.status                AS Status,
               ST_AsGeoJSON(d.location) AS GeoJson,
               NULL::text              AS NodeType,
               NULL::int               AS DiameterMm,
               NULL::text              AS Material,
               NULL::double precision  AS LengthM,
               NULL::text              AS FromNodeId,
               NULL::text              AS ToNodeId,
               d.device_type           AS DeviceType,
               d.host_pipe_id          AS HostPipeId,
               d.host_node_id          AS HostNodeId,
               s.lifecycle_status      AS LifecycleStatus
        FROM network_devices d
        LEFT JOIN network_asset_states s ON s.asset_id = d.id AND s.tenant_id = @tenantId
        WHERE d.tenant_id = @tenantId AND d.deleted_at IS NULL
          AND d.location && ST_MakeEnvelope(@minLng, @minLat, @maxLng, @maxLat, 4326)
        """;
```

> `ORDER BY id` ở cuối query gốc vẫn hoạt động — `id` là output column alias, không mơ hồ vì mỗi nhánh chỉ select `<alias>.id AS Id`.

- [ ] **Step 5: Cập nhật handler — map LifecycleStatus từ row**

Modify `GetAssetsInBboxQueryHandler.cs` — đổi dòng:
```csharp
                LifecycleStatus: null,           // GIS-5 populates from network_asset_states
```
thành:
```csharp
                LifecycleStatus: row.LifecycleStatus,
```

- [ ] **Step 6: Chạy → pass (cả test cũ + mới)**

Run:
```bash
dotnet test src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests --filter GetAssetsInBboxApiTests
```
Expected: PASS toàn bộ — gồm `Feature_LifecycleStatus_Is_Populated_From_Projection` (Suspended) và `Returns_FeatureCollection_With_Seeded_Node` (node chưa project → lifecycleStatus null vẫn đúng).

- [ ] **Step 7: Commit**

```bash
git add src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Ports/IBboxAssetReadDao.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Infrastructure/Repositories/BboxAssetReadDao.cs \
        src/services/water-network-gis-be/src/WaterNetwork.Gis.Application/Queries/GetAssetsInBboxQueryHandler.cs \
        src/services/water-network-gis-be/tests/WaterNetwork.Gis.IntegrationTests/GetAssetsInBboxApiTests.cs
git commit -m "feat(gis): bbox query joins projection for lifecycleStatus (GIS-5, closes GIS-4 defer)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Docs + decision record + full verification

**Files:**
- Create: `docs/decisions/0013-gis-asset-state-projection.md`
- Modify: `docs/conventions/event-catalog.md`
- Modify: `docs/conventions/template-mapping.md`
- Modify: `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` (tick GIS-5)
- Modify: `docs/stories/backlog.md` (đóng follow-up + thêm mục GIS-5)

- [ ] **Step 1: Viết decision record 0013**

Create `docs/decisions/0013-gis-asset-state-projection.md`:

```markdown
# 0013 GIS-5 Asset State Projection

Date: 2026-06-15

## Status

Accepted

## Context

GIS-5 dựng projection `network_asset_states` để bbox query trả `lifecycleStatus`.
Ba câu hỏi cần chốt: (1) seed trạng thái khởi tạo thế nào, (2) chống event sai
thứ tự ra sao, (3) lấy `tenant_id` ở đâu khi payload `asset.status.changed`
không có tenant và envelope tenant null cho event publish qua outbox.

## Decision

1. **Seed từ `asset.registered` + cập nhật bằng `asset.status.changed`.** Registration
   chỉ emit `asset.registered` (Status="Active"), KHÔNG emit `status.changed` →
   phải seed để projection không rỗng cho asset chưa transition. KHÔNG subscribe
   `asset.decommissioned` (redundant: `status.changed` đã mang newStatus="Decommissioned").

2. **OccurredAt ordering guard.** Upsert chỉ đè khi
   `excluded.updated_at >= network_asset_states.updated_at`. Inbox chỉ chặn
   redelivery trùng eventId; guard chống regress khi 2 event KHÁC nhau tới sai thứ tự.

3. **Tenant derive từ bảng GIS cục bộ.** `envelope.TenantId` = null cho event publish
   qua outbox (xác nhận ở `MassTransitIntegrationEventPublisher` — ambient tenant null
   trong OutboxProcessor scope); `AssetStatusChangedV1` cũng không có tenant. Vì
   `asset_id == GIS asset id` (decision #2) và asset sinh TỪ GIS event (row GIS luôn
   tồn tại trước), consumer `SELECT tenant_id FROM network_{nodes|pipes|devices}
   WHERE id = @assetId` (bảng theo `Data.AssetType`).

4. **Promote `IdempotentEnvelopeConsumer` base class** lên building-blocks (filter
   EventType + inbox dedup + core broker-free). Refactor cả asset-be + gis-be.

## Consequences

- Projection rỗng → bbox trả `lifecycleStatus: null` (hợp US-P1-06) chỉ khi chưa nhận
  event nào cho asset đó; sau seed registered là có giá trị.
- gis-be lần đầu là consumer side → dùng bảng `processed_events` (inbox) đã có sẵn.
- gis Infrastructure phụ thuộc `WaterNetwork.Asset.Contracts` (consumer ref producer
  contract — đối xứng asset→gis ở AST-1).

## Follow-ups

- `tenant_id` trong projection hiện chỉ phục vụ hygiene + index; bbox join đúng nhờ
  asset_id (UUID) duy nhất. Nếu sau cần query projection độc lập theo tenant, index
  đã sẵn.
- Khi consumer thứ 3 cần `IsUniqueViolation` (PG 23505), promote helper lên
  building-blocks (vẫn copy ở asset-be).
```

- [ ] **Step 2: Cập nhật event catalog**

Modify `docs/conventions/event-catalog.md` — thêm gis-be vào cột consumers của `asset.registered` và `asset.status.changed` (tìm 2 dòng tương ứng, thêm `water-network-gis-be (GIS-5 projection)`). Nếu chưa có dòng, thêm theo format hiện có của file.

- [ ] **Step 3: Cập nhật template-mapping**

Modify `docs/conventions/template-mapping.md` — thêm mục ghi pattern `IdempotentEnvelopeConsumer` base class (building-block cho consumer envelope: filter EventType + inbox dedup + core broker-free; subclass override `ConsumerName`/`Subscribes`/`HandleAsync`).

- [ ] **Step 4: Tick checkbox + roadmap + backlog**

Modify `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md`:
- §3.3 bảng: đổi `| 1 | GIS-5 Projection ... |` → thêm `✓`.
- §4.5 mục 5: thêm "✓ SHIPPED".

Modify `docs/stories/backlog.md`:
- Dòng Phase 1 status: thêm `GIS-5` vào danh sách done.
- Follow-up GIS-4 "lifecycleStatus deferred": gạch `~~...~~` DONE (commit Task 7).
- Follow-up AST-1 "Promote IdempotentEnvelopeConsumer": gạch DONE (Task 1).
- Thêm mục "## Follow-up sau GIS-5" với các điểm: tenant_id projection redundancy, poison-message retry budget (kế thừa), seed phụ thuộc asset.registered.

- [ ] **Step 5: Full verification — cả 2 solution xanh 0 warning**

Run:
```bash
dotnet test src/services/water-network-gis-be/WaterNetwork.Gis.slnx
dotnet test src/services/water-network-asset-be/WaterNetwork.Asset.slnx
dotnet build WaterPlatform.BuildingBlocks.slnx
```
Expected: tất cả PASS, 0 warning (TreatWarningsAsErrors).

- [ ] **Step 6: Compose parse**

Run:
```bash
docker compose -f src/services/water-network-gis-be/docker-compose.yml config --quiet
```
Expected: không output (parse OK). Nếu compose nằm ở root, dùng path đúng.

- [ ] **Step 7: Commit docs**

```bash
git add docs/
git commit -m "docs(gis): decision 0013 + event catalog + tracking ticks (GIS-5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §A base class → Task 1; §B consumer → Task 5; §C migration → Task 2 + store → Task 3; §D bbox → Task 7; §E wiring → Task 5 Step 6; tenant derive (spec decision #6) → Task 4; tests (mọi tầng) → Task 3/5/6/7; docs → Task 8. ✓
- **Tenant source:** dùng `AssetTenantLookupDao` (Task 4), KHÔNG `envelope.TenantId` (đã verify null cho outbox). ✓
- **Type consistency:** `IAssetStateProjectionStore.UpsertAsync(assetId, tenantId, lifecycleStatus, occurredAt, lastEventId, ct)` dùng nhất quán Task 3/5/7; `IAssetTenantLookupDao.GetTenantAsync(assetId, assetKind, ct)` nhất quán Task 4/5; `BboxAssetRow.LifecycleStatus` field cuối nhất quán Task 7. ✓
- **Consumer name:** `"gis.asset-lifecycle-projection"` nhất quán consumer (Task 5 Step 5) + test inbox assert (Task 5 Step 3). ✓
```
