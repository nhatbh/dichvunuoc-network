using FluentAssertions;
using WaterNetwork.Design.Application.Validators;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class CreateDesignProjectTests
{
    [Fact]
    public void Validator_Requires_Name()
    {
        var v = new CreateDesignProjectCommandValidator();
        v.Validate(new CreateDesignProjectCommand("", null, null)).IsValid.Should().BeFalse();
        v.Validate(new CreateDesignProjectCommand("Plan A", "branch-1", null)).IsValid.Should().BeTrue();
    }

    [Fact]
    public void Create_Sets_Open_Status_And_Raises_Event()
    {
        var p = DesignProject.Create("tenant-1", "Plan A", "branch-1", "zone-2");

        p.TenantId.Should().Be("tenant-1");
        p.Name.Should().Be("Plan A");
        p.Status.Should().Be(DesignProjectStatus.Open);
        p.Id.Should().NotBeNullOrWhiteSpace();

        var evt = p.GetDomainEvents().OfType<DesignProjectCreated>().Single();
        evt.AggregateId.Should().Be(p.Id);
        evt.Data.Name.Should().Be("Plan A");
        evt.Data.TenantId.Should().Be("tenant-1");
        evt.Data.BranchId.Should().Be("branch-1");
        evt.Data.ZoneId.Should().Be("zone-2");
    }
}
