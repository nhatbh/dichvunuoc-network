using FluentAssertions;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.DomainEvents;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Incident.UnitTests;

public sealed class NetworkIncidentTests
{
    private static NetworkIncident Reported() => NetworkIncident.Report(
        tenantId: "tenant-1",
        category: IncidentCategory.PipeBurst,
        severity: 3,
        longitude: 106.7,
        latitude: 10.8,
        affectedRefs: new[] { AssetRef.Create("pipe-1", AssetRefKind.Pipe, verified: true) },
        reportedBy: "operator-1");

    [Fact]
    public void Report_Starts_In_Reported_And_Raises_Event_And_Timeline()
    {
        var incident = Reported();
        incident.Status.Should().Be(IncidentStatus.Reported);
        incident.Category.Should().Be(IncidentCategory.PipeBurst);
        incident.Severity.Should().Be(3);
        incident.AffectedRefs.Should().ContainSingle(r => r.AssetId == "pipe-1");
        incident.TimelineEntries.Should().ContainSingle(t => t.EntryType == TimelineEntryType.Reported);
        incident.GetDomainEvents().Should().ContainSingle(e => e is IncidentReported);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    public void Report_With_Severity_Out_Of_Range_Throws(int severity)
    {
        var act = () => NetworkIncident.Report("tenant-1", IncidentCategory.Leak, severity,
            longitude: null, latitude: null, affectedRefs: Array.Empty<AssetRef>(), reportedBy: "op");
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void Classify_From_Reported_Moves_To_Classified_And_Raises_Event()
    {
        var incident = Reported();
        incident.ClearDomainEvents();
        incident.Classify(IncidentCategory.Leak, severity: 2, actorId: "op-2", note: "reassessed");
        incident.Status.Should().Be(IncidentStatus.Classified);
        incident.Category.Should().Be(IncidentCategory.Leak);
        incident.Severity.Should().Be(2);
        incident.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.Classified);
        incident.GetDomainEvents().Should().ContainSingle(e => e is IncidentClassified);
    }

    [Fact]
    public void Cancel_Requires_Reason()
    {
        var incident = Reported();
        var act = () => incident.Cancel(reason: "  ", actorId: "op");
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void Cancel_From_Reported_Moves_To_Cancelled_And_Raises_Event()
    {
        var incident = Reported();
        incident.ClearDomainEvents();
        incident.Cancel(reason: "duplicate report", actorId: "op-3");
        incident.Status.Should().Be(IncidentStatus.Cancelled);
        incident.CancellationReason.Should().Be("duplicate report");
        incident.GetDomainEvents().Should().ContainSingle(e => e is IncidentCancelled);
    }

    [Fact]
    public void Classify_After_Cancel_Throws()
    {
        var incident = Reported();
        incident.Cancel("cancelled", "op");
        var act = () => incident.Classify(IncidentCategory.Other, 1, "op", note: null);
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void Report_With_Longitude_Without_Latitude_Throws()
    {
        var act = () => NetworkIncident.Report("tenant-1", IncidentCategory.Leak, severity: 2,
            longitude: 106.7, latitude: null, affectedRefs: Array.Empty<AssetRef>(), reportedBy: "op");
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void Reclassify_From_Classified_Stays_Classified_And_Updates_Fields()
    {
        var incident = Reported();
        incident.Classify(IncidentCategory.Leak, severity: 2, actorId: "op-2", note: "first");
        incident.ClearDomainEvents();

        incident.Classify(IncidentCategory.WaterLoss, severity: 4, actorId: "op-3", note: "second");

        incident.Status.Should().Be(IncidentStatus.Classified);
        incident.Category.Should().Be(IncidentCategory.WaterLoss);
        incident.Severity.Should().Be(4);
        incident.TimelineEntries.Count(t => t.EntryType == TimelineEntryType.Classified).Should().Be(2);
        incident.GetDomainEvents().Should().ContainSingle(e => e is IncidentClassified);
    }

    [Fact]
    public void Cancel_From_Classified_Moves_To_Cancelled_And_Raises_Event()
    {
        var incident = Reported();
        incident.Classify(IncidentCategory.Leak, severity: 2, actorId: "op-2", note: null);
        incident.ClearDomainEvents();

        incident.Cancel(reason: "resolved as duplicate", actorId: "op-3");

        incident.Status.Should().Be(IncidentStatus.Cancelled);
        incident.CancellationReason.Should().Be("resolved as duplicate");
        incident.GetDomainEvents().Should().ContainSingle(e => e is IncidentCancelled);
    }

    [Fact]
    public void Cancel_From_Resolved_Throws()
    {
        // Walk incident all the way to Resolved (the terminal state per decision 0024).
        var incident = Reported();
        incident.Classify(IncidentCategory.PipeBurst, 3, "op", note: null);
        incident.RequestIsolationAnalysis("node-1", "op");
        incident.RecordIsolationPlan(1, ["v1"], ["node-1"], ["p1"], "op");
        incident.ConfirmIsolationPlan("op", note: null);
        incident.StartIncidentHandling("op", note: null);
        incident.ResolveIncident("op", resolutionNote: "all clear");

        incident.Status.Should().Be(IncidentStatus.Resolved);

        // Attempting to cancel a terminal Resolved incident must be rejected.
        var act = () => incident.Cancel(reason: "oops", actorId: "op");
        act.Should().Throw<BusinessRuleException>();
    }
}
