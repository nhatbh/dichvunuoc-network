using FluentAssertions;
using WaterNetwork.Incident.Contracts;
using WaterNetwork.Incident.Contracts.Events;
using WaterNetwork.Incident.Domain.DomainEvents;
using WaterNetwork.Incident.Infrastructure.IntegrationEvents;

namespace WaterNetwork.Incident.UnitTests;

public sealed class IncidentIntegrationEventMapperTests
{
    private readonly IncidentIntegrationEventMapper _mapper = new();

    [Fact]
    public void Maps_IsolationPlanConfirmed_To_V1()
    {
        var domain = new IncidentIsolationPlanConfirmed("inc-1", new IncidentIsolationPlanConfirmedData(
            "tenant-1", "plan-1", 9, ["v1"], ["node-1"], ["p1"],
            [new IncidentAssetRefData("node-1", "Node")], "operator-1"));

        _mapper.CanMap("IncidentIsolationPlanConfirmed").Should().BeTrue();
        var ie = _mapper.Map(domain)!;
        ie.EventType.Should().Be(IncidentEventTypes.IsolationPlanConfirmed);
        ie.Should().BeOfType<IncidentIsolationPlanConfirmedIntegrationEvent>()
            .Which.Data.Should().BeEquivalentTo(new IncidentIsolationPlanConfirmedV1(
                "inc-1", "tenant-1", "plan-1", 9, ["v1"], ["node-1"], ["p1"],
                [new IncidentAssetRefV1("node-1", "Node")], "operator-1"));
    }

    [Fact]
    public void Maps_WorkOrderRequested_To_V1()
    {
        var domain = new WorkOrderRequested("inc-1", new WorkOrderRequestedData(
            [new IncidentAssetRefData("node-1", "Node")], "PipeBurst severity 3", 3));

        var ie = _mapper.Map(domain)!;
        ie.EventType.Should().Be(IncidentEventTypes.WorkOrderRequested);
        ie.Should().BeOfType<WorkOrderRequestedIntegrationEvent>()
            .Which.Data.Should().BeEquivalentTo(new WorkOrderRequestedV1(
                "inc-1", [new IncidentAssetRefV1("node-1", "Node")], "PipeBurst severity 3", 3));
    }

    [Fact]
    public void Maps_IncidentResolved_To_V1()
    {
        var domain = new IncidentResolved("inc-1", new IncidentResolvedData("tenant-1", "operator-1", "fixed"));

        var ie = _mapper.Map(domain)!;
        ie.EventType.Should().Be(IncidentEventTypes.Resolved);
        ie.Should().BeOfType<IncidentResolvedIntegrationEvent>()
            .Which.Data.Should().BeEquivalentTo(new IncidentResolvedV1("inc-1", "tenant-1", "operator-1", "fixed"));
    }
}
