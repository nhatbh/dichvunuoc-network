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
        // TenantContext(string TenantId, string? OrganizationId = null, string? BranchId = null)
        _tenant.Current.Returns(new TenantContext("tenant-1", null, null));
        // RequestContext(string CorrelationId, string? CausationId = null, string? UserId = null, string? TenantId = null)
        _ctx.Current().Returns(new RequestContext("corr-1", UserId: "user-7"));
    }

    private NetworkAsset Active(string id = "node-1") =>
        NetworkAsset.RegisterFromGis(id, "tenant-1", AssetType.Node, "ND-001");

    [Fact]
    public async Task Suspend_Loads_Mutates_Saves()
    {
        var asset = Active(); _repo.GetByIdAsync("tenant-1", "node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx);

        var id = await handler.HandleAsync(new SuspendAssetCommand("node-1", "win"), CancellationToken.None);

        id.Should().Be("node-1");
        asset.Status.Should().Be(AssetStatus.Suspended);
        await _repo.Received(1).SaveAsync(asset, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Command_On_Missing_Asset_Throws_NotFound()
    {
        _repo.GetByIdAsync("tenant-1", "nope", Arg.Any<CancellationToken>()).Returns((NetworkAsset?)null);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx);
        await handler.Invoking(h => h.HandleAsync(new SuspendAssetCommand("nope", null), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
    }

    [Fact]
    public async Task Command_Without_Tenant_Context_Throws_Unauthorized()
    {
        _tenant.Current.Returns((TenantContext?)null);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx);
        await handler.Invoking(h => h.HandleAsync(new SuspendAssetCommand("node-1", null), CancellationToken.None))
            .Should().ThrowAsync<UnauthorizedException>();
    }

    [Fact]
    public async Task Invalid_Transition_Propagates_BusinessRuleException()
    {
        var asset = Active(); asset.Suspend("u", null);  // now Suspended
        _repo.GetByIdAsync("tenant-1", "node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx); // Suspend again → invalid
        await handler.Invoking(h => h.HandleAsync(new SuspendAssetCommand("node-1", null), CancellationToken.None))
            .Should().ThrowAsync<BusinessRuleException>();
    }

    [Fact]
    public async Task Activate_From_Suspended_Saves_Active()
    {
        var asset = Active(); asset.Suspend("u", null);
        _repo.GetByIdAsync("tenant-1", "node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new ActivateAssetCommandHandler(_repo, _tenant, _ctx);
        await handler.HandleAsync(new ActivateAssetCommand("node-1", null), CancellationToken.None);
        asset.Status.Should().Be(AssetStatus.Active);
    }

    [Fact]
    public async Task Decommission_Saves_Terminal()
    {
        var asset = Active();
        _repo.GetByIdAsync("tenant-1", "node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new DecommissionAssetCommandHandler(_repo, _tenant, _ctx);
        await handler.HandleAsync(new DecommissionAssetCommand("node-1", "eol"), CancellationToken.None);
        asset.Status.Should().Be(AssetStatus.Decommissioned);
        asset.DecommissionReason.Should().Be("eol");
    }

    [Fact]
    public async Task UpdateTechnicalProfile_Saves_Profile()
    {
        var asset = Active();
        _repo.GetByIdAsync("tenant-1", "node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new UpdateAssetTechnicalProfileCommandHandler(_repo, _tenant, _ctx);
        await handler.HandleAsync(new UpdateAssetTechnicalProfileCommand("node-1", 2019, "Acme", "V-200",
            new Dictionary<string, string?> { ["k"] = "v" }), CancellationToken.None);
        asset.TechnicalProfile!.InstallationYear.Should().Be(2019);
    }

    [Fact]
    public async Task MarkAsMaintenance_Saves_UnderMaintenance()
    {
        var asset = Active();
        _repo.GetByIdAsync("tenant-1", "node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new MarkAssetAsMaintenanceCommandHandler(_repo, _tenant, _ctx);
        await handler.HandleAsync(new MarkAssetAsMaintenanceCommand("node-1", null), CancellationToken.None);
        asset.Status.Should().Be(AssetStatus.UnderMaintenance);
    }

    [Fact]
    public async Task Command_On_Asset_Owned_By_Other_Tenant_Throws_NotFound_And_Does_Not_Save()
    {
        var asset = Active();
        // Stubbed only for a different tenant; caller is "tenant-1" → overload returns null.
        _repo.GetByIdAsync("tenant-999", "node-1", Arg.Any<CancellationToken>()).Returns(asset);
        var handler = new SuspendAssetCommandHandler(_repo, _tenant, _ctx);

        await handler.Invoking(h => h.HandleAsync(new SuspendAssetCommand("node-1", null), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
        // Falsifies a regression to the 1-arg overload: the handler MUST scope the load
        // by the caller's own tenant ("tenant-1"), so the other-tenant stub never matches.
        await _repo.Received(1).GetByIdAsync("tenant-1", "node-1", Arg.Any<CancellationToken>());
        await _repo.DidNotReceive().SaveAsync(Arg.Any<NetworkAsset>(), Arg.Any<CancellationToken>());
    }
}
