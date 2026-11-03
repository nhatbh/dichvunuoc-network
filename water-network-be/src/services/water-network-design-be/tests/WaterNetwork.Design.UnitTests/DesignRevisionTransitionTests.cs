using FluentAssertions;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.UnitTests;

public sealed class DesignRevisionTransitionTests
{
    private static DesignRevision Validated()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.ApplyValidation(ValidationResult.Empty);
        rev.ClearDomainEvents();
        return rev;
    }

    [Fact]
    public void Submit_From_Validated_Moves_To_Submitted_And_Records_Transition()
    {
        var rev = Validated();

        rev.Submit("user-1", "corr-1");

        rev.Status.Should().Be(DesignRevisionStatus.Submitted);
        rev.Transitions.Should().ContainSingle();
        var t = rev.Transitions[0];
        t.FromStatus.Should().Be(DesignRevisionStatus.Validated);
        t.ToStatus.Should().Be(DesignRevisionStatus.Submitted);
        t.ActorId.Should().Be("user-1");
        t.CorrelationId.Should().Be("corr-1");
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionSubmitted);
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Draft)]
    [InlineData(DesignRevisionStatus.Submitted)]
    [InlineData(DesignRevisionStatus.Approved)]
    public void Submit_From_Non_Validated_Throws(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.Submit("user-1", null);
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("InvalidRevisionTransition");
    }

    [Fact]
    public void Approve_From_Submitted_Moves_To_Approved_With_Optional_Reason()
    {
        var rev = Validated();
        rev.Submit("user-1", null);
        rev.ClearDomainEvents();

        rev.Approve("approver-1", "looks good", "corr-2");

        rev.Status.Should().Be(DesignRevisionStatus.Approved);
        rev.Transitions.Should().HaveCount(2);
        rev.Transitions[^1].ToStatus.Should().Be(DesignRevisionStatus.Approved);
        rev.Transitions[^1].Reason.Should().Be("looks good");
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionApproved);
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Draft)]
    [InlineData(DesignRevisionStatus.Validated)]
    [InlineData(DesignRevisionStatus.Approved)]
    public void Approve_From_Non_Submitted_Throws(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.Approve("approver-1", null, null);
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("InvalidRevisionTransition");
    }

    [Fact]
    public void Reject_From_Submitted_Returns_To_Draft_And_Clears_Validation()
    {
        var rev = Validated();
        rev.Submit("user-1", null);
        rev.ClearDomainEvents();

        rev.Reject("approver-1", "missing elevation", "corr-3");

        rev.Status.Should().Be(DesignRevisionStatus.Draft);
        rev.ValidationResult.Should().BeNull();
        rev.Transitions[^1].FromStatus.Should().Be(DesignRevisionStatus.Submitted);
        rev.Transitions[^1].ToStatus.Should().Be(DesignRevisionStatus.Draft);
        rev.Transitions[^1].Reason.Should().Be("missing elevation");
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionRejected);
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Draft)]
    [InlineData(DesignRevisionStatus.Validated)]
    [InlineData(DesignRevisionStatus.Approved)]
    public void Reject_From_Non_Submitted_Throws(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.Reject("approver-1", "some reason", null);
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("InvalidRevisionTransition");
    }

    [Fact]
    public void Reject_Without_Reason_Throws()
    {
        var rev = Validated();
        rev.Submit("user-1", null);
        var act = () => rev.Reject("approver-1", "  ", null);
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("RejectReasonRequired");
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Submitted)]
    [InlineData(DesignRevisionStatus.Approved)]
    public void EnsureDraftsEditable_Throws_When_Not_Editable(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.EnsureDraftsEditable();
        act.Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("RevisionNotEditable");
    }

    [Theory]
    [InlineData(DesignRevisionStatus.Draft)]
    [InlineData(DesignRevisionStatus.Validated)]
    public void EnsureDraftsEditable_Allows_Editable_States(DesignRevisionStatus from)
    {
        var rev = ReconstituteWith(from);
        var act = () => rev.EnsureDraftsEditable();
        act.Should().NotThrow();
    }

    private static DesignRevision ReconstituteWith(DesignRevisionStatus status) =>
        DesignRevision.Reconstitute("id-1", "proj-1", "tenant-1", 1, status,
            validationResult: null, version: 1,
            createdAt: DateTime.UtcNow, updatedAt: DateTime.UtcNow,
            transitions: Array.Empty<DesignRevisionTransition>());
}
