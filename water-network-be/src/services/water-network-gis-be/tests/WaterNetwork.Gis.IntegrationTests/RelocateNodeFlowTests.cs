using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

/// <summary>
/// Integration test for the RelocateNode command flow.
/// Proves atomicity: store + repo share the same scoped GisDbContext,
/// so the geometry_version row and the node update commit in a single transaction.
/// </summary>
public class RelocateNodeFlowTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static async Task MigrateAsync(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await db.Database.MigrateAsync();
    }

    /// <summary>
    /// Registers a node via the RegisterNodeCommandHandler (which also appends geometry v1),
    /// then relocates it via RelocateNodeCommandHandler.
    /// Asserts:
    ///   (a) node.Location changed in DB
    ///   (b) geometry_versions has 2 rows (v1 from register, v2 from relocate)
    ///   (c) v2 carries the new coordinates
    /// </summary>
    [Fact]
    public async Task Relocate_Node_Updates_Location_And_Creates_Two_GeometryVersions()
    {
        await using var factory = new GisApiFactory(postgis);

        // ── Register ─────────────────────────────────────────────────────────
        string nodeId;
        {
            using var scope = factory.Services.CreateScope();
            await MigrateAsync(scope);

            // Set tenant context for this scope
            var tenantAccessor = scope.ServiceProvider.GetRequiredService<ITenantContextAccessor>();
            ((TenantContextAccessor)tenantAccessor).SetContext(new TenantContext("tenant-flow-001"));

            var registerHandler = scope.ServiceProvider
                .GetRequiredService<ICommandHandler<RegisterNodeCommand, string>>();

            nodeId = await registerHandler.HandleAsync(
                new RegisterNodeCommand(
                    AssetCode: $"ND-{Guid.NewGuid():N}"[..12],
                    NodeType: "Junction",
                    Latitude: 10.0,
                    Longitude: 106.0),
                CancellationToken.None);
        }

        // ── Relocate ─────────────────────────────────────────────────────────
        {
            using var scope = factory.Services.CreateScope();

            var tenantAccessor = scope.ServiceProvider.GetRequiredService<ITenantContextAccessor>();
            ((TenantContextAccessor)tenantAccessor).SetContext(new TenantContext("tenant-flow-001"));

            var relocateHandler = scope.ServiceProvider
                .GetRequiredService<ICommandHandler<RelocateNodeCommand, string>>();

            var result = await relocateHandler.HandleAsync(
                new RelocateNodeCommand(nodeId, Latitude: 10.5, Longitude: 106.5, Reason: "survey fix"),
                CancellationToken.None);

            result.Should().Be(nodeId);
        }

        // ── Assert ────────────────────────────────────────────────────────────
        {
            using var scope = factory.Services.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

            // (a) Node location changed.
            var nodeRepo = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();
            var node = await nodeRepo.GetByIdAsync(nodeId);
            node.Should().NotBeNull();
            node!.Location.Latitude.Should().BeApproximately(10.5, 1e-6);
            node.Location.Longitude.Should().BeApproximately(106.5, 1e-6);

            // (b) Two geometry_version rows exist for this asset.
            var versions = await dbContext.GeometryVersions
                .Where(v => v.AssetId == nodeId)
                .OrderBy(v => v.Version)
                .ToListAsync();

            versions.Should().HaveCount(2, "v1 from register + v2 from relocate");

            // (c) v2 carries the new coordinates.
            var v1 = versions.First(v => v.Version == 1);
            v1.GeoJson.Should().Contain("106");
            v1.GeoJson.Should().Contain("10");

            var v2 = versions.First(v => v.Version == 2);
            v2.GeoJson.Should().Contain("106.5");
            v2.GeoJson.Should().Contain("10.5");
            v2.Reason.Should().Be("survey fix");
        }
    }

    /// <summary>
    /// Verifies that store and nodeRepository share the same scoped GisDbContext.
    /// After a relocate, the node row and geometry_version row are both committed
    /// in the same transaction: if the scope is used to read back both, they are consistent.
    /// </summary>
    [Fact]
    public async Task Store_And_NodeRepository_Share_Same_DbContext_Scope()
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        await MigrateAsync(scope);

        // Resolve store and repo from the same scope — they must share the same GisDbContext.
        var store = scope.ServiceProvider.GetRequiredService<IGeometryVersionStore>();
        var nodeRepo = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();

        // Both are scoped; verify by object-reference equality on the db context they hold.
        // (We can verify indirectly: stage a node + geometry version and then SaveChanges once
        //  via the outbox path of nodeRepo.SaveAsync — both rows should appear.)
        var node = NetworkNode.Register("tenant-scope-check", new AssetCode("ND-scope-01"), NodeType.Junction,
            new GeoPoint(10.0, 106.0));

        // Stage geometry version (no SaveChanges inside AppendAsync).
        var geoJson = """{"type":"Point","coordinates":[106.0,10.0]}""";
        var gv = WaterNetwork.Gis.Domain.Entities.GeometryVersion.Create(node.Id, AssetKind.Parse("Node"), 1, geoJson);
        await store.AppendAsync(gv);

        // SaveAsync on nodeRepo → PersistWithOutboxAsync → single SaveChangesAsync.
        // Because store and repo share the same scoped dbContext, the geometry_version row
        // staged by AppendAsync is committed in this same SaveChangesAsync call.
        await nodeRepo.SaveAsync(node);

        // Both rows must now be visible in DB.
        var savedNode = await nodeRepo.GetByIdAsync(node.Id);
        savedNode.Should().NotBeNull("node row must have been committed by nodeRepo.SaveAsync");

        var gvRows = await dbContext.GeometryVersions
            .Where(v => v.AssetId == node.Id)
            .ToListAsync();
        gvRows.Should().HaveCount(1, "geometry_version staged by AppendAsync must be committed atomically with the node row");
    }
}
