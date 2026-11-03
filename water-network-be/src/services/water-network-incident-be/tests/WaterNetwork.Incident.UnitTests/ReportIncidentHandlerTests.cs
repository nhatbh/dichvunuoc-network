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
        // TenantContext is a positional record: TenantContext(string TenantId, ...)
        _tenant.Current.Returns(new TenantContext("tenant-1"));
        // RequestContext: (string CorrelationId, string? CausationId = null, string? UserId = null, ...)
        _ctx.Current().Returns(new RequestContext("corr-1", UserId: "operator-1"));
        _repo.SaveAsync(Arg.Any<NetworkIncident>(), Arg.Any<CancellationToken>())
            .Returns(ci => Task.FromResult(ci.Arg<NetworkIncident>()));
    }

    private ReportIncidentCommandHandler Handler() => new(_repo, _gis, _tenant, _ctx);

    [Fact]
    public async Task Existing_Ref_Is_Marked_Verified()
    {
        _gis.AssetRefExists("tenant-1", AssetRefKind.Pipe, "pipe-1", Arg.Any<CancellationToken>()).Returns(true);
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
        _gis.AssetRefExists("tenant-1", AssetRefKind.Node, "ghost", Arg.Any<CancellationToken>()).Returns(false);
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
        _tenant.Current.Returns((TenantContext?)null);
        var cmd = new ReportIncidentCommand(IncidentCategory.Other, 1, null, null, Array.Empty<ReportIncidentAssetRef>());
        var act = async () => await Handler().HandleAsync(cmd, default);
        await act.Should().ThrowAsync<UnauthorizedException>();
    }
}
