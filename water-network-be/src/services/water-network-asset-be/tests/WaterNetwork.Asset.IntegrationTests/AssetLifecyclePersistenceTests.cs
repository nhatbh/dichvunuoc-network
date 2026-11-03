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
    private static (AssetApiFactory, IServiceScope) Boot(PostgisFixture postgis)
    {
        var f = new AssetApiFactory(postgis);
        var s = f.Services.CreateScope();
        s.ServiceProvider.GetRequiredService<AssetDbContext>().Database.Migrate();
        return (f, s);
    }

    [Fact]
    public async Task Transition_Then_Reload_Persists_Status_And_Appends_Lifecycle_Entry()
    {
        var (f, scope) = Boot(postgis); await using var _ = f; using var __ = scope;
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var id = $"node-{Guid.CreateVersion7():N}";
        var a = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[^8..]}");
        await repo.SaveAsync(a);
        a.Suspend("user-7", "win");
        await repo.SaveAsync(a);

        var reloaded = await repo.GetByIdAsync(id);
        reloaded!.Status.Should().Be(AssetStatus.Suspended);
        reloaded.LifecycleEntries.Should().HaveCount(2); // Registered→Active, Active→Suspended
        reloaded.LifecycleEntries[^1].ToStatus.Should().Be(AssetStatus.Suspended);
    }

    [Fact]
    public async Task UpdateTechnicalProfile_Then_Reload_RoundTrips_Jsonb_Attributes()
    {
        var (f, scope) = Boot(postgis); await using var _ = f; using var __ = scope;
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var id = $"node-{Guid.CreateVersion7():N}";
        var a = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[^8..]}");
        await repo.SaveAsync(a);
        a.UpdateTechnicalProfile("user-7", 2019, "Acme", "V-200",
            new Dictionary<string, string?> { ["pressureRating"] = "PN16" });
        await repo.SaveAsync(a);

        var reloaded = await repo.GetByIdAsync(id);
        reloaded!.TechnicalProfile!.InstallationYear.Should().Be(2019);
        reloaded.TechnicalProfile.Attributes["pressureRating"].Should().Be("PN16");
    }

    [Fact]
    public async Task UpdateTechnicalProfile_Twice_Overwrites_Without_Duplicate_Row()
    {
        var (f, scope) = Boot(postgis); await using var _ = f; using var __ = scope;
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var id = $"node-{Guid.CreateVersion7():N}";
        var a = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[^8..]}");
        await repo.SaveAsync(a);
        a.UpdateTechnicalProfile("user-7", 2019, "Acme", "V-200",
            new Dictionary<string, string?> { ["pressureRating"] = "PN16" });
        await repo.SaveAsync(a);
        a.UpdateTechnicalProfile("user-7", 2021, "Beta", "V-300",
            new Dictionary<string, string?> { ["pressureRating"] = "PN20", ["material"] = "PVC" });
        await repo.SaveAsync(a);

        var reloaded = await repo.GetByIdAsync(id);
        reloaded!.TechnicalProfile!.InstallationYear.Should().Be(2021);
        reloaded.TechnicalProfile.Manufacturer.Should().Be("Beta");
        reloaded.TechnicalProfile.Attributes.Should().HaveCount(2);
        reloaded.TechnicalProfile.Attributes["pressureRating"].Should().Be("PN20");
        // The upsert UPDATE path would throw a PK violation if it had re-inserted instead of mutating.
    }

    [Fact]
    public async Task Decommission_Then_Reload_Persists_Terminal_State_And_Record()
    {
        var (f, scope) = Boot(postgis); await using var _ = f; using var __ = scope;
        var repo = scope.ServiceProvider.GetRequiredService<INetworkAssetRepository>();
        var id = $"node-{Guid.CreateVersion7():N}";
        var a = NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, $"ND-{id[^8..]}");
        await repo.SaveAsync(a);
        a.Decommission("user-7", "eol");
        await repo.SaveAsync(a);

        var reloaded = await repo.GetByIdAsync(id);
        reloaded!.Status.Should().Be(AssetStatus.Decommissioned);
        reloaded.DecommissionReason.Should().Be("eol");
        reloaded.DecommissionedBy.Should().Be("user-7");
    }
}
