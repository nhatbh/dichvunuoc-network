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

public sealed class RequestIsolationAnalysisHandlerTests
{
    private readonly INetworkIncidentRepository _repo = Substitute.For<INetworkIncidentRepository>();
    private readonly ITopologyAnalysisPort _topology = Substitute.For<ITopologyAnalysisPort>();
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();
    private readonly IRequestContextProvider _request = Substitute.For<IRequestContextProvider>();

    public RequestIsolationAnalysisHandlerTests()
    {
        // TenantContext(TenantId, OrganizationId?, BranchId?); RequestContext(CorrelationId, CausationId?, UserId?, TenantId?).
        _tenant.Current.Returns(new TenantContext("tenant-1"));
        _request.Current().Returns(new RequestContext("corr-1", UserId: "operator-1", TenantId: "tenant-1"));
    }

    private RequestIsolationAnalysisCommandHandler Handler() =>
        new(_repo, _topology, _tenant, _request);

    private static NetworkIncident Classified(string tenant = "tenant-1")
    {
        var i = NetworkIncident.Report(tenant, IncidentCategory.PipeBurst, 3, 1, 1,
            [AssetRef.Create("node-1", AssetRefKind.Node, true)], "operator-1");
        i.Classify(IncidentCategory.PipeBurst, 3, "operator-1", null);
        return i;
    }

    [Fact]
    public async Task Success_Records_Plan_And_Returns_Ready()
    {
        var incident = Classified();
        _repo.GetByIdAsync(incident.Id, Arg.Any<CancellationToken>()).Returns(incident);
        _topology.ComputeIsolationZoneAsync("tenant-1", "node-1", Arg.Any<CancellationToken>())
            .Returns(new IsolationZoneResult(["v1"], ["node-1"], ["p1"], 9));

        var result = await Handler().HandleAsync(
            new RequestIsolationAnalysisCommand(incident.Id, "node-1"), CancellationToken.None);

        result.Status.Should().Be("Proposed");
        result.IncidentStatus.Should().Be("IsolationPlanReady");
        result.ValvesToClose.Should().Equal("v1");
        result.GraphVersion.Should().Be(9);
        await _repo.Received(1).SaveAsync(incident, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Topology_Failure_Records_AnalysisFailed_And_Returns_Retryable()
    {
        var incident = Classified();
        _repo.GetByIdAsync(incident.Id, Arg.Any<CancellationToken>()).Returns(incident);
        _topology.ComputeIsolationZoneAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns<IsolationZoneResult>(_ => throw new TopologyAnalysisException("unreachable"));

        var result = await Handler().HandleAsync(
            new RequestIsolationAnalysisCommand(incident.Id, "node-1"), CancellationToken.None);

        result.Status.Should().Be("AnalysisFailed");
        result.IncidentStatus.Should().Be("IsolationRequested");
        result.FailureReason.Should().Contain("unreachable");
        await _repo.Received(1).SaveAsync(incident, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Other_Tenants_Incident_Throws_NotFound()
    {
        var incident = Classified("other-tenant");
        _repo.GetByIdAsync(incident.Id, Arg.Any<CancellationToken>()).Returns(incident);

        await Handler().Invoking(h => h.HandleAsync(
                new RequestIsolationAnalysisCommand(incident.Id, "node-1"), CancellationToken.None))
            .Should().ThrowAsync<NotFoundException>();
    }

    [Fact]
    public async Task Wrong_State_Throws_BusinessRule()
    {
        var reported = NetworkIncident.Report("tenant-1", IncidentCategory.Leak, 2, null, null, [], "op");
        _repo.GetByIdAsync(reported.Id, Arg.Any<CancellationToken>()).Returns(reported);

        await Handler().Invoking(h => h.HandleAsync(
                new RequestIsolationAnalysisCommand(reported.Id, "node-1"), CancellationToken.None))
            .Should().ThrowAsync<BusinessRuleException>();
    }
}
