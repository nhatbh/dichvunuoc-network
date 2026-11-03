using FluentAssertions;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Design.UnitTests;

public sealed class DesignRevisionPublishTransitionTests
{
    private static readonly IReadOnlyList<double> PointCoords = [106.7, 10.8];

    private static DesignRevision Approved()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.ApplyValidation(ValidationResult.Empty);
        rev.Submit("designer", "corr-1");
        rev.Approve("approver", reason: null, "corr-2");
        return rev;
    }

    [Fact]
    public void MarkPublished_all_imported_sets_Published()
    {
        var rev = Approved();
        rev.MarkPublished(importedCount: 3, failedCount: 0, "importer", "corr-3");
        rev.Status.Should().Be(DesignRevisionStatus.Published);
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionPublished);
    }

    [Fact]
    public void MarkPublished_with_failures_sets_PartiallyPublished()
    {
        var rev = Approved();
        rev.MarkPublished(importedCount: 2, failedCount: 1, "importer", "corr-3");
        rev.Status.Should().Be(DesignRevisionStatus.PartiallyPublished);
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionPublished);
    }

    [Fact]
    public void MarkPublished_from_non_Approved_throws()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1); // Draft
        var act = () => rev.MarkPublished(1, 0, "importer", "corr-3");
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void MarkPublished_records_transition()
    {
        var rev = Approved();
        rev.MarkPublished(1, 0, "importer", "corr-3");
        rev.Transitions.Should().Contain(t =>
            t.FromStatus == DesignRevisionStatus.Approved && t.ToStatus == DesignRevisionStatus.Published);
    }

    [Fact]
    public void EnsureDraftsEditable_throws_when_Published()
    {
        var rev = Approved();
        rev.MarkPublished(importedCount: 3, failedCount: 0, "importer", "corr-3");
        var act = () => rev.EnsureDraftsEditable();
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void EnsureDraftsEditable_throws_when_PartiallyPublished()
    {
        var rev = Approved();
        rev.MarkPublished(importedCount: 2, failedCount: 1, "importer", "corr-3");
        var act = () => rev.EnsureDraftsEditable();
        act.Should().Throw<BusinessRuleException>();
    }

    [Fact]
    public void BeginPublish_from_Approved_raises_ReadyForGis_without_status_change()
    {
        var rev = Approved();
        var drafts = new[]
        {
            new DraftAssetSnapshot("d1", "Node", "N-1", "cr-1",
                new DraftGeometrySnapshot("Point", [PointCoords]),
                new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null)
        };

        rev.BeginPublish(drafts, approvedBy: "approver");

        rev.Status.Should().Be(DesignRevisionStatus.Approved); // unchanged until completion
        var evt = rev.GetDomainEvents().OfType<DesignAssetReadyForGis>().Single();
        evt.Data.Assets.Should().ContainSingle(a => a.AssetCode == "N-1");
        evt.Data.ApprovedBy.Should().Be("approver");
    }

    [Fact]
    public void BeginPublish_from_non_Approved_throws()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        var act = () => rev.BeginPublish(Array.Empty<DraftAssetSnapshot>(), "approver");
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("InvalidRevisionTransition");
    }
}
