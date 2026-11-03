using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

[Collection("incident-postgis")]
public sealed class IsolationPlanPersistenceTests(PostgisFixture postgis)
{
    [Fact]
    public async Task Plan_Survives_Save_And_Reload_With_Supersede()
    {
        using var factory = new IncidentApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<INetworkIncidentRepository>();

        var incident = NetworkIncident.Report("tenant-iso", IncidentCategory.PipeBurst, 3, 1, 1,
            [AssetRef.Create("node-1", AssetRefKind.Node, true)], "operator-1");
        incident.Classify(IncidentCategory.PipeBurst, 3, "operator-1", null);
        await repo.SaveAsync(incident, default);

        var reloaded = await repo.GetByIdAsync(incident.Id, default);
        reloaded!.RequestIsolationAnalysis("node-1", "operator-1");
        reloaded.RecordIsolationPlan(1, ["v1"], ["node-1"], ["p1"], "operator-1");
        await repo.SaveAsync(reloaded, default);

        var afterFirst = await repo.GetByIdAsync(incident.Id, default);
        afterFirst!.RequestIsolationAnalysis("node-1", "operator-1");
        afterFirst.RecordIsolationPlan(2, ["v2"], ["node-1"], [], "operator-1");
        await repo.SaveAsync(afterFirst, default);

        var final = await repo.GetByIdAsync(incident.Id, default);
        final!.Status.Should().Be(IncidentStatus.IsolationPlanReady);
        final.IsolationPlans.Count(p => p.Status == IsolationPlanStatus.Superseded).Should().Be(1);
        var active = final.IsolationPlans.Single(p => p.Status == IsolationPlanStatus.Proposed);
        active.GraphVersion.Should().Be(2);
        active.ValvesToClose.Should().Equal("v2");
    }
}
