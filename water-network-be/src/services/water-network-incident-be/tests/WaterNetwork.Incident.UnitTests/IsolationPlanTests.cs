using FluentAssertions;
using WaterNetwork.Incident.Domain.Entities;
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.UnitTests;

public sealed class IsolationPlanTests
{
    [Fact]
    public void Proposed_Captures_Snapshot()
    {
        var plan = IsolationPlan.Proposed(
            incidentId: "inc-1", startNodeId: "node-1", graphVersion: 7,
            valvesToClose: ["v2", "v1"], isolatedNodes: ["n1"], isolatedPipes: ["p1"], sequence: 0);

        plan.Status.Should().Be(IsolationPlanStatus.Proposed);
        plan.StartNodeId.Should().Be("node-1");
        plan.GraphVersion.Should().Be(7);
        plan.ValvesToClose.Should().Equal("v2", "v1");
        plan.IsolatedNodes.Should().Equal("n1");
        plan.IsolatedPipes.Should().Equal("p1");
        plan.FailureReason.Should().BeNull();
        plan.Sequence.Should().Be(0);
        plan.Id.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public void Failed_Has_Reason_And_Empty_Lists()
    {
        var plan = IsolationPlan.Failed("inc-1", "node-1", "topology unreachable", sequence: 1);

        plan.Status.Should().Be(IsolationPlanStatus.AnalysisFailed);
        plan.FailureReason.Should().Be("topology unreachable");
        plan.ValvesToClose.Should().BeEmpty();
        plan.IsolatedNodes.Should().BeEmpty();
        plan.IsolatedPipes.Should().BeEmpty();
        plan.GraphVersion.Should().Be(0);
        plan.Sequence.Should().Be(1);
    }

    [Fact]
    public void Supersede_Only_Allowed_From_Proposed()
    {
        var proposed = IsolationPlan.Proposed("inc-1", "node-1", 1, [], [], [], 0);
        var superseded = proposed.AsSuperseded();
        superseded.Status.Should().Be(IsolationPlanStatus.Superseded);

        var failed = IsolationPlan.Failed("inc-1", "node-1", "x", 0);
        failed.Invoking(p => p.AsSuperseded()).Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void AsConfirmed_From_Proposed_Sets_Confirmed()
    {
        var plan = IsolationPlan.Proposed("inc-1", "node-1", 7, ["v1"], ["node-1"], ["p1"], sequence: 0);
        var confirmed = plan.AsConfirmed();
        confirmed.Status.Should().Be(IsolationPlanStatus.Confirmed);
        confirmed.Id.Should().Be(plan.Id);
        // Records are immutable: AsConfirmed() uses `with`, so the original must be unchanged.
        plan.Status.Should().Be(IsolationPlanStatus.Proposed);
    }

    [Fact]
    public void AsConfirmed_From_NonProposed_Throws()
    {
        var plan = IsolationPlan.Failed("inc-1", "node-1", "boom", sequence: 0);
        plan.Invoking(p => p.AsConfirmed()).Should().Throw<InvalidOperationException>();
    }
}
