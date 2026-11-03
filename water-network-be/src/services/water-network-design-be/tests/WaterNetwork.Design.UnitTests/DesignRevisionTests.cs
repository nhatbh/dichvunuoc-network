// DesignRevisionTests.cs
using FluentAssertions;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class DesignRevisionTests
{
    [Fact]
    public void Create_Starts_In_Draft_And_Raises_Event()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.Status.Should().Be(DesignRevisionStatus.Draft);
        rev.RevisionNumber.Should().Be(1);
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionCreated);
    }

    [Fact]
    public void ApplyValidation_With_No_Errors_Moves_To_Validated()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.ClearDomainEvents();

        rev.ApplyValidation(ValidationResult.Empty);

        rev.Status.Should().Be(DesignRevisionStatus.Validated);
        rev.ValidationResult.Should().Be(ValidationResult.Empty);
        rev.GetDomainEvents().Should().ContainSingle(e => e is DesignRevisionValidated);
    }

    [Fact]
    public void ApplyValidation_With_Errors_Stays_Draft()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        var withError = new ValidationResult(
            new[] { new ValidationIssue("InvalidGeometry", "d1", null, "geometry", "bad") },
            Array.Empty<ValidationIssue>());

        rev.ApplyValidation(withError);

        rev.Status.Should().Be(DesignRevisionStatus.Draft);
        rev.ValidationResult!.HasErrors.Should().BeTrue();
    }

    [Fact]
    public void MarkDraftsChanged_Resets_Validated_To_Draft_And_Clears_Result()
    {
        var rev = DesignRevision.Create("proj-1", "tenant-1", 1);
        rev.ApplyValidation(ValidationResult.Empty);
        rev.Status.Should().Be(DesignRevisionStatus.Validated);

        rev.MarkDraftsChanged();

        rev.Status.Should().Be(DesignRevisionStatus.Draft);
        rev.ValidationResult.Should().BeNull();
    }
    [Theory]
    [InlineData(DesignRevisionStatus.Submitted)]
    [InlineData(DesignRevisionStatus.Approved)]
    [InlineData(DesignRevisionStatus.Published)]
    [InlineData(DesignRevisionStatus.PartiallyPublished)]
    public void Revalidation_Cannot_Reopen_A_Locked_Revision(DesignRevisionStatus status)
    {
        var revision = DesignRevision.Reconstitute("r1", "p1", "shw", 1, status,
            ValidationResult.Empty, 5, DateTime.UtcNow, DateTime.UtcNow, []);
        var action = () => revision.ApplyValidation(ValidationResult.Empty);
        action.Should().Throw<WaterPlatform.BuildingBlocks.Domain.Exceptions.BusinessRuleException>();
        revision.Status.Should().Be(status);
        revision.Version.Should().Be(5);
        revision.GetDomainEvents().Should().BeEmpty();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Every_Draft_Save_Invalidates_Validation_And_Advances_Concurrency_With_An_Event(bool validated)
    {
        var revision = DesignRevision.Create("p1", "shw", 1);
        if (validated) revision.ApplyValidation(ValidationResult.Empty);
        revision.ClearDomainEvents();
        var version = revision.Version;
        revision.MarkDraftsChanged();
        revision.Version.Should().Be(version + 1);
        revision.GetDomainEvents().Should().ContainSingle();
        revision.Status.Should().Be(DesignRevisionStatus.Draft);
        revision.ValidationResult.Should().BeNull();
    }
}
