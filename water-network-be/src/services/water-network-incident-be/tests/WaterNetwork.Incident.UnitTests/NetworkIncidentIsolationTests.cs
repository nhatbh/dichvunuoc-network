using FluentAssertions;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.DomainEvents;
using WaterNetwork.Incident.Domain.Entities;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Incident.UnitTests;

public sealed class NetworkIncidentIsolationTests
{
    private static NetworkIncident Classified()
    {
        var i = NetworkIncident.Report("tenant-1", IncidentCategory.PipeBurst, 3, 106.7, 10.8,
            [AssetRef.Create("node-1", AssetRefKind.Node, true)], "operator-1");
        i.Classify(IncidentCategory.PipeBurst, 3, "operator-1", note: null);
        return i;
    }

    private static NetworkIncident PlanReady()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.RecordIsolationPlan(5, ["v1"], ["node-1"], ["p1"], "operator-1");
        return i;
    }

    [Fact]
    public void RequestIsolationAnalysis_From_Classified_Moves_To_IsolationRequested()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");

        i.Status.Should().Be(IncidentStatus.IsolationRequested);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.IsolationRequested);
    }

    [Fact]
    public void RequestIsolationAnalysis_From_Reported_Throws()
    {
        var i = NetworkIncident.Report("tenant-1", IncidentCategory.Leak, 2, null, null, [], "op");
        i.Invoking(x => x.RequestIsolationAnalysis("node-1", "op"))
            .Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void RecordIsolationPlan_Adds_Proposed_Plan_Event_And_Moves_To_Ready()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.ClearDomainEvents();

        i.RecordIsolationPlan(
            graphVersion: 5, valvesToClose: ["v1"], isolatedNodes: ["node-1"], isolatedPipes: ["p1"],
            actorId: "operator-1");

        i.Status.Should().Be(IncidentStatus.IsolationPlanReady);
        i.IsolationPlans.Should().ContainSingle(p => p.Status == IsolationPlanStatus.Proposed);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.IsolationPlanReady);
        i.GetDomainEvents().Should().ContainSingle(e => e is IncidentIsolationPlanCreated);
    }

    [Fact]
    public void RecordAnalysisFailure_Keeps_IsolationRequested_And_Adds_Failed_Plan_No_Event()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.ClearDomainEvents();

        i.RecordAnalysisFailure("topology unreachable", "operator-1");

        i.Status.Should().Be(IncidentStatus.IsolationRequested);
        i.IsolationPlans.Should().ContainSingle(p => p.Status == IsolationPlanStatus.AnalysisFailed);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.AnalysisFailed);
        i.GetDomainEvents().Should().BeEmpty();
    }

    [Fact]
    public void Reanalysis_Supersedes_Prior_Proposed_Plan()
    {
        var i = Classified();
        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.RecordIsolationPlan(1, ["v1"], ["node-1"], [], "operator-1");

        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.RecordIsolationPlan(2, ["v2"], ["node-1"], [], "operator-1");

        i.IsolationPlans.Count(p => p.Status == IsolationPlanStatus.Superseded).Should().Be(1);
        i.IsolationPlans.Count(p => p.Status == IsolationPlanStatus.Proposed).Should().Be(1);
        i.IsolationPlans.Single(p => p.Status == IsolationPlanStatus.Proposed).GraphVersion.Should().Be(2);
    }

    [Fact]
    public void Success_Path_Bumps_Version_Exactly_Once_With_One_Event()
    {
        var i = Classified();
        var v0 = i.Version;
        i.ClearDomainEvents();

        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.RecordIsolationPlan(1, ["v1"], ["node-1"], ["p1"], "operator-1");

        (i.Version - v0).Should().Be(i.GetDomainEvents().Count); // invariant: bumps == events
        i.GetDomainEvents().Count.Should().Be(1);
        (i.Version - v0).Should().Be(1);
    }

    [Fact]
    public void Failure_Path_Does_Not_Bump_Version_And_Emits_No_Event()
    {
        var i = Classified();
        var v0 = i.Version;
        i.ClearDomainEvents();

        i.RequestIsolationAnalysis("node-1", "operator-1");
        i.RecordAnalysisFailure("topology unreachable", "operator-1");

        (i.Version - v0).Should().Be(i.GetDomainEvents().Count); // invariant: 0 == 0
        i.GetDomainEvents().Should().BeEmpty();
        (i.Version - v0).Should().Be(0);
    }

    [Fact]
    public void ConfirmIsolationPlan_From_PlanReady_Confirms_Plan_And_Emits_Event()
    {
        var i = PlanReady();
        i.ClearDomainEvents();

        i.ConfirmIsolationPlan("operator-1", note: null);

        i.Status.Should().Be(IncidentStatus.IsolationConfirmed);
        i.IsolationPlans.Should().ContainSingle(p => p.Status == IsolationPlanStatus.Confirmed);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.IsolationConfirmed);
        i.GetDomainEvents().Should().ContainSingle(e => e is IncidentIsolationPlanConfirmed);
    }

    [Fact]
    public void ConfirmIsolationPlan_From_Classified_Throws()
    {
        var i = Classified();
        i.Invoking(x => x.ConfirmIsolationPlan("op", null))
            .Should().Throw<BusinessRuleException>().WithMessage("*InvalidIncidentTransition*");
    }

    [Fact]
    public void ConfirmIsolationPlan_IsolationPlanReady_NoProposedPlan_Throws_NoProposedPlan()
    {
        // This inconsistent state (IsolationPlanReady with no Proposed plan) is not reachable via the normal
        // public transition flow; we build it directly via Reconstitute to exercise the guard.
        var now = DateTime.UtcNow;
        var incident = NetworkIncident.Reconstitute(
            id: Guid.CreateVersion7().ToString(),
            tenantId: "tenant-1",
            category: IncidentCategory.PipeBurst,
            severity: 3,
            longitude: null, latitude: null,
            status: IncidentStatus.IsolationPlanReady,
            reportedBy: "operator-1",
            cancellationReason: null,
            version: 1,
            createdAt: now, updatedAt: now,
            affectedRefs: [],
            timeline: [IncidentTimelineEntry.Create(TimelineEntryType.Reported, "operator-1", null, 0)],
            isolationPlans: []   // no Proposed plan — triggers NoProposedPlan guard
        );

        incident.Invoking(x => x.ConfirmIsolationPlan("operator-1", null))
            .Should().Throw<BusinessRuleException>().WithMessage("*NoProposedPlan*");
    }

    [Fact]
    public void StartIncidentHandling_From_Confirmed_Moves_To_InProgress_And_Emits_WorkOrder()
    {
        var i = PlanReady();
        i.ConfirmIsolationPlan("operator-1", null);
        i.ClearDomainEvents();

        i.StartIncidentHandling("operator-1", null);

        i.Status.Should().Be(IncidentStatus.InProgress);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.HandlingStarted);
        i.GetDomainEvents().Should().ContainSingle(e => e is WorkOrderRequested);
    }

    [Fact]
    public void StartIncidentHandling_From_PlanReady_Throws()
    {
        var i = PlanReady();
        i.Invoking(x => x.StartIncidentHandling("op", null)).Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void ResolveIncident_From_InProgress_Moves_To_Resolved_And_Emits_Event()
    {
        var i = PlanReady();
        i.ConfirmIsolationPlan("operator-1", null);
        i.StartIncidentHandling("operator-1", null);
        i.ClearDomainEvents();

        i.ResolveIncident("operator-1", resolutionNote: "fixed");

        i.Status.Should().Be(IncidentStatus.Resolved);
        i.TimelineEntries.Should().Contain(t => t.EntryType == TimelineEntryType.Resolved);
        i.GetDomainEvents().Should().ContainSingle(e => e is IncidentResolved);
    }

    [Fact]
    public void ResolveIncident_From_Confirmed_Throws()
    {
        var i = PlanReady();
        i.ConfirmIsolationPlan("operator-1", null);
        i.Invoking(x => x.ResolveIncident("op", null)).Should().Throw<BusinessRuleException>();
    }
}
