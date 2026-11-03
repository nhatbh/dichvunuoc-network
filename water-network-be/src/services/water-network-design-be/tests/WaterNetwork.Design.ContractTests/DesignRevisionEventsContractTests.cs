// DesignRevisionEventsContractTests.cs
using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;

namespace WaterNetwork.Design.ContractTests;

public sealed class DesignRevisionEventsContractTests
{
    [Fact]
    public void RevisionCreated_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionCreatedV1("rev-1", "p1", "tenant-1", 2);
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "RevisionNumber");
    }

    [Fact]
    public void RevisionValidated_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionValidatedV1("rev-1", "p1", "tenant-1", 0, 1, true);
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "ErrorCount", "WarningCount", "IsValid");
    }

    [Fact]
    public void Event_Types_Are_Fixed()
    {
        DesignEventTypes.RevisionCreated.Should().Be("design.revision.created");
        DesignEventTypes.RevisionValidated.Should().Be("design.revision.validated");
    }

    [Fact]
    public void RevisionSubmitted_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionSubmittedV1("rev-1", "p1", "tenant-1", 2, "user-1");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "RevisionNumber", "ActorId");
    }

    [Fact]
    public void RevisionApproved_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionApprovedV1("rev-1", "p1", "tenant-1", 2, "approver-1", "ok");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "RevisionNumber", "ActorId", "Reason");
    }

    [Fact]
    public void RevisionRejected_V1_Schema_Is_Stable()
    {
        var evt = new DesignRevisionRejectedV1("rev-1", "p1", "tenant-1", 2, "approver-1", "missing data");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("RevisionId", "ProjectId", "TenantId", "RevisionNumber", "ActorId", "Reason");
    }

    [Fact]
    public void Approval_Event_Types_Are_Fixed()
    {
        DesignEventTypes.RevisionSubmitted.Should().Be("design.revision.submitted");
        DesignEventTypes.RevisionApproved.Should().Be("design.revision.approved");
        DesignEventTypes.RevisionRejected.Should().Be("design.revision.rejected");
    }
}
