using FluentAssertions;
using NSubstitute;
using WaterNetwork.Incident.Application.Commands;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Incident.UnitTests;

/// <summary>
/// In-memory fake repository that stores aggregates by id.
/// SaveAsync overwrites and GetByIdAsync returns the stored instance.
/// </summary>
file sealed class FakeNetworkIncidentRepository : INetworkIncidentRepository
{
    private readonly Dictionary<string, NetworkIncident> _store = new();

    public Task<NetworkIncident> SaveAsync(NetworkIncident incident, CancellationToken ct = default)
    {
        _store[incident.Id] = incident;
        return Task.FromResult(incident);
    }

    public Task<NetworkIncident?> GetByIdAsync(string id, CancellationToken ct = default)
        => Task.FromResult(_store.TryGetValue(id, out var i) ? i : (NetworkIncident?)null);
}

public sealed class Inc3CommandHandlerTests
{
    private readonly ITenantContextAccessor _tenant = Substitute.For<ITenantContextAccessor>();
    private readonly IRequestContextProvider _request = Substitute.For<IRequestContextProvider>();

    public Inc3CommandHandlerTests()
    {
        _tenant.Current.Returns(new TenantContext("tenant-1"));
        _request.Current().Returns(new RequestContext("corr-1", UserId: "operator-1", TenantId: "tenant-1"));
    }

    /// <summary>
    /// Builds a NetworkIncident already at IsolationPlanReady for tenant-1.
    /// Mirrors the Classified() helper in RequestIsolationAnalysisHandlerTests,
    /// then advances through IsolationRequested -> IsolationPlanReady.
    /// </summary>
    private static NetworkIncident PlanReadyIncident(string tenant = "tenant-1")
    {
        var i = NetworkIncident.Report(tenant, IncidentCategory.PipeBurst, 3, 1, 1,
            [AssetRef.Create("node-1", AssetRefKind.Node, true)], "operator-1");
        i.Classify(IncidentCategory.PipeBurst, 3, "operator-1", null);
        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.RecordIsolationPlan(9, ["v1"], ["node-1"], ["p1"], "operator-1");
        return i;
    }

    [Fact]
    public async Task Confirm_Then_Start_Then_Resolve_Walks_To_Resolved()
    {
        // arrange: seed PlanReady incident for tenant-1 in fake repo
        var repo = new FakeNetworkIncidentRepository();
        var incident = PlanReadyIncident("tenant-1");
        await repo.SaveAsync(incident);

        var confirmHandler = new ConfirmIsolationPlanCommandHandler(repo, _tenant, _request);
        var startHandler = new StartIncidentHandlingCommandHandler(repo, _tenant, _request);
        var resolveHandler = new ResolveIncidentCommandHandler(repo, _tenant, _request);

        // act + assert: ConfirmIsolationPlanCommandHandler -> IsolationConfirmed
        await confirmHandler.HandleAsync(new ConfirmIsolationPlanCommand(incident.Id, "looks good"), CancellationToken.None);
        var afterConfirm = await repo.GetByIdAsync(incident.Id);
        afterConfirm!.Status.Should().Be(IncidentStatus.IsolationConfirmed);

        // act + assert: StartIncidentHandlingCommandHandler -> InProgress
        await startHandler.HandleAsync(new StartIncidentHandlingCommand(incident.Id, null), CancellationToken.None);
        var afterStart = await repo.GetByIdAsync(incident.Id);
        afterStart!.Status.Should().Be(IncidentStatus.InProgress);

        // act + assert: ResolveIncidentCommandHandler -> Resolved
        await resolveHandler.HandleAsync(new ResolveIncidentCommand(incident.Id, "all fixed"), CancellationToken.None);
        var afterResolve = await repo.GetByIdAsync(incident.Id);
        afterResolve!.Status.Should().Be(IncidentStatus.Resolved);
    }

    [Fact]
    public async Task Confirm_CrossTenant_Throws_NotFound()
    {
        // arrange: incident owned by tenant-1, tenant accessor returns tenant-2
        var repo = new FakeNetworkIncidentRepository();
        var incident = PlanReadyIncident("tenant-1");
        await repo.SaveAsync(incident);

        // Override tenant context to tenant-2
        _tenant.Current.Returns(new TenantContext("tenant-2"));

        var handler = new ConfirmIsolationPlanCommandHandler(repo, _tenant, _request);

        // act + assert: cross-tenant access must throw NotFoundException
        var act = async () => await handler.HandleAsync(
            new ConfirmIsolationPlanCommand(incident.Id, null), CancellationToken.None);

        await act.Should().ThrowAsync<NotFoundException>();
    }
}
