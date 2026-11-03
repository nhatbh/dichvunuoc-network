using FluentAssertions;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
namespace WaterNetwork.Design.UnitTests;
public sealed class NetworkEditRevisionTests
{
    private static NetworkEditOperation Add() => new("op1", "Add", "Node", null, null,
        new DraftAssetSnapshot("op1", "Node", "N1", "op1", new("Point", [[105, 21]]), new Dictionary<string,string>(), null, null, null), null);
    [Fact] public void Save_Uses_Revision_Version_And_Resets_Validation()
    {
        var r = DesignRevision.Create("p", "shw", 1);
        r.ApplyValidation(ValidationResult.Empty);
        var version = r.Version;
        r.SaveNetworkEdits([Add()], version);
        r.Version.Should().Be(version + 1);
        r.Status.Should().Be(DesignRevisionStatus.Draft);
        r.NetworkEdits.Should().ContainSingle();
        ((Action)(() => r.SaveNetworkEdits([], version))).Should().Throw<ConcurrencyException>();
        r.NetworkEdits.Should().ContainSingle();
    }
    [Fact] public void Cannot_Save_Submitted_Changes()
    {
        var r = DesignRevision.Create("p", "shw", 1);
        r.SaveNetworkEdits([Add()], r.Version);
        r.ApplyValidation(ValidationResult.Empty); r.Submit("author", null);
        ((Action)(() => r.SaveNetworkEdits([], r.Version))).Should().Throw<BusinessRuleException>();
    }
    [Fact] public void Cannot_Repeat_Operation_Or_Target()
    {
        var r = DesignRevision.Create("p", "shw", 1);
        ((Action)(() => r.SaveNetworkEdits([Add(), Add()], r.Version))).Should().Throw<BusinessRuleException>();
        var update = Add() with { Action = "Update", TargetId = "node1", ExpectedVersion = 0, Before = Add().After };
        ((Action)(() => r.SaveNetworkEdits([update, update with { Id = "op2" }], r.Version))).Should().Throw<BusinessRuleException>();
    }
    [Fact] public void Update_Requires_Server_Snapshot_And_Version()
    {
        var r = DesignRevision.Create("p", "shw", 1);
        ((Action)(() => r.SaveNetworkEdits([Add() with {Action="Update", TargetId="node1"}], r.Version))).Should().Throw<BusinessRuleException>();
    }
}
