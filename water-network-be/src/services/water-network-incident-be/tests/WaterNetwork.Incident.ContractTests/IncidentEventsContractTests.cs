using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Incident.Contracts;
using WaterNetwork.Incident.Contracts.Events;

namespace WaterNetwork.Incident.ContractTests;

public sealed class IncidentEventsContractTests
{
    [Fact]
    public void Event_Types_Are_Fixed()
    {
        IncidentEventTypes.Reported.Should().Be("incident.reported");
        IncidentEventTypes.Classified.Should().Be("incident.classified");
        IncidentEventTypes.Cancelled.Should().Be("incident.cancelled");
    }

    [Fact]
    public void IncidentReported_V1_Schema_Is_Stable()
    {
        var evt = new IncidentReportedV1(
            "inc-1", "tenant-1", "PipeBurst", 3, 106.7, 10.8,
            new[] { new AffectedAssetRefV1("pipe-1", "Pipe", true) }, "operator-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "Category", "Severity",
                "Longitude", "Latitude", "AffectedRefs", "ReportedBy");
    }

    [Fact]
    public void IncidentCancelled_V1_Schema_Is_Stable()
    {
        var evt = new IncidentCancelledV1("inc-1", "tenant-1", "duplicate", "op-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "Reason", "CancelledBy");
    }

    [Fact]
    public void IncidentClassified_V1_Schema_Is_Stable()
    {
        var evt = new IncidentClassifiedV1("inc-1", "tenant-1", "Leak", 2, "op-1", "note");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "Category", "Severity", "ClassifiedBy", "Note");
    }

    [Fact]
    public void IsolationPlanCreated_Event_Type_Is_Fixed()
    {
        IncidentEventTypes.IsolationPlanCreated.Should().Be("incident.isolation-plan-created");
    }

    [Fact]
    public void IncidentIsolationPlanCreated_V1_Schema_Is_Stable()
    {
        string[] valves = ["v1"];
        string[] nodes = ["node-1"];
        string[] pipes = ["p1"];
        var evt = new IncidentIsolationPlanCreatedV1(
            "inc-1", "tenant-1", "plan-1", "node-1", 9,
            valves, nodes, pipes, "operator-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "PlanId", "StartNodeId", "GraphVersion",
                "ValvesToClose", "IsolatedNodes", "IsolatedPipes", "ComputedBy");
    }

    [Fact]
    public void Inc3_Event_Types_Are_Fixed()
    {
        IncidentEventTypes.IsolationPlanConfirmed.Should().Be("incident.isolation-plan-confirmed");
        IncidentEventTypes.Resolved.Should().Be("incident.resolved");
        IncidentEventTypes.WorkOrderRequested.Should().Be("maintenance.work-order-requested");
    }

    [Fact]
    public void IncidentIsolationPlanConfirmed_V1_Schema_Is_Stable()
    {
        var evt = new IncidentIsolationPlanConfirmedV1(
            "inc-1", "tenant-1", "plan-1", 9, ["v1"], ["node-1"], ["p1"],
            new[] { new IncidentAssetRefV1("node-1", "Node") }, "operator-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "PlanId", "GraphVersion",
                "ValvesToClose", "IsolatedNodes", "IsolatedPipes", "AffectedRefs", "ConfirmedBy");
    }

    [Fact]
    public void WorkOrderRequested_V1_Schema_Is_Stable()
    {
        var evt = new WorkOrderRequestedV1(
            "inc-1", new[] { new IncidentAssetRefV1("node-1", "Node") }, "PipeBurst severity 3", 3);
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "AssetRefs", "Summary", "Severity");
        doc.RootElement.GetProperty("AssetRefs")[0].EnumerateObject().Select(p => p.Name)
            .Should().Equal("AssetId", "Kind");
    }

    [Fact]
    public void IncidentResolved_V1_Schema_Is_Stable()
    {
        var evt = new IncidentResolvedV1("inc-1", "tenant-1", "operator-1", "fixed");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("IncidentId", "TenantId", "ResolvedBy", "ResolutionNote");
    }
}
