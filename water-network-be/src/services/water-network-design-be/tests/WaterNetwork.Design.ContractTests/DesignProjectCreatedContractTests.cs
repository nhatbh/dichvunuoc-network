using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;

namespace WaterNetwork.Design.ContractTests;

public sealed class DesignProjectCreatedContractTests
{
    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        var evt = new DesignProjectCreatedV1("p1", "tenant-1", "Plan A", "b1", "z2");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("ProjectId", "TenantId", "Name", "BranchId", "ZoneId");
    }

    [Fact]
    public void EventType_Is_Fixed() => DesignEventTypes.ProjectCreated.Should().Be("design.project.created");
}
