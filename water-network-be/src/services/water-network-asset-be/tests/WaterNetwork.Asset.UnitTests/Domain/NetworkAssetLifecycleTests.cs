using FluentAssertions;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class NetworkAssetLifecycleTests
{
    private static NetworkAsset NewActiveAsset() =>
        NetworkAsset.RegisterFromGis("node-1", "tenant-1", AssetType.Node, "ND-001");

    private static NetworkAsset AssetInStatus(AssetStatus status) =>
        NetworkAsset.Reconstitute("node-1", "tenant-1", AssetType.Node, "ND-001", status,
            version: 1, createdAt: DateTime.UtcNow, updatedAt: DateTime.UtcNow, lifecycleEntries: []);

    [Fact]
    public void Suspend_From_Active_Sets_Suspended_Appends_Entry_Raises_StatusChanged()
    {
        var a = NewActiveAsset();
        a.ClearDomainEvents();
        a.Suspend("user-7", "maintenance window");

        a.Status.Should().Be(AssetStatus.Suspended);
        a.LifecycleEntries[^1].Should().Match<WaterNetwork.Asset.Domain.Entities.AssetLifecycleEntry>(e =>
            e.FromStatus == AssetStatus.Active && e.ToStatus == AssetStatus.Suspended &&
            e.ActorId == "user-7" && e.Reason == "maintenance window");
        var evt = a.GetDomainEvents().OfType<AssetStatusChanged>().Single();
        evt.Data.PreviousStatus.Should().Be("Active");
        evt.Data.NewStatus.Should().Be("Suspended");
        evt.Data.ChangedBy.Should().Be("user-7");
        evt.Data.Reason.Should().Be("maintenance window");
    }

    [Fact]
    public void MarkAsMaintenance_From_Active_Sets_UnderMaintenance()
    {
        var a = NewActiveAsset();
        a.MarkAsMaintenance("user-7", null);
        a.Status.Should().Be(AssetStatus.UnderMaintenance);
        a.GetDomainEvents().OfType<AssetStatusChanged>().Last().Data.NewStatus.Should().Be("UnderMaintenance");
    }

    [Theory]
    [InlineData(AssetStatus.Suspended)]
    [InlineData(AssetStatus.UnderMaintenance)]
    public void Activate_From_Suspended_Or_Maintenance_Sets_Active(AssetStatus from)
    {
        var a = AssetInStatus(from);
        a.Activate("user-7", "back online");
        a.Status.Should().Be(AssetStatus.Active);
        a.GetDomainEvents().OfType<AssetStatusChanged>().Last().Data.NewStatus.Should().Be("Active");
    }

    [Theory]
    [InlineData(AssetStatus.Active)]
    [InlineData(AssetStatus.UnderMaintenance)]
    [InlineData(AssetStatus.Suspended)]
    public void Decommission_From_NonTerminal_Sets_Decommissioned_Raises_Two_Events_And_Bumps_Version_By_Two(AssetStatus from)
    {
        var a = AssetInStatus(from);
        var v0 = a.Version;
        a.Decommission("user-7", "end of life");

        a.Status.Should().Be(AssetStatus.Decommissioned);
        a.Version.Should().Be(v0 + 2, "decommission raises 2 events so version must advance by 2 for outbox/concurrency bookkeeping");
        a.GetDomainEvents().OfType<AssetStatusChanged>().Single().Data.NewStatus.Should().Be("Decommissioned");
        var dec = a.GetDomainEvents().OfType<AssetDecommissioned>().Single();
        dec.Data.Reason.Should().Be("end of life");
        dec.Data.DecommissionedBy.Should().Be("user-7");
        a.DecommissionReason.Should().Be("end of life");
        a.DecommissionedBy.Should().Be("user-7");
    }

    [Theory]
    [InlineData(AssetStatus.Active)]
    public void Activate_From_Active_Throws_InvalidTransition(AssetStatus from)
    {
        var a = AssetInStatus(from);
        var act = () => a.Activate("user-7", null);
        act.Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("InvalidAssetTransition");
    }

    [Theory]
    [InlineData(AssetStatus.Suspended)]
    [InlineData(AssetStatus.UnderMaintenance)]
    public void MarkAsMaintenance_From_NonActive_Throws_InvalidTransition(AssetStatus from)
    {
        var act = () => AssetInStatus(from).MarkAsMaintenance("user-7", null);
        act.Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("InvalidAssetTransition");
    }

    [Theory]
    [InlineData(AssetStatus.Suspended)]
    [InlineData(AssetStatus.UnderMaintenance)]
    public void Suspend_From_NonActive_Throws_InvalidTransition(AssetStatus from)
    {
        var act = () => AssetInStatus(from).Suspend("user-7", null);
        act.Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("InvalidAssetTransition");
    }

    [Fact]
    public void Any_Command_On_Decommissioned_Throws_AlreadyDecommissioned()
    {
        var a = AssetInStatus(AssetStatus.Decommissioned);
        a.Invoking(x => x.Activate("u", null)).Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("AssetAlreadyDecommissioned");
        a.Invoking(x => x.Suspend("u", null)).Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("AssetAlreadyDecommissioned");
        a.Invoking(x => x.MarkAsMaintenance("u", null)).Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("AssetAlreadyDecommissioned");
        a.Invoking(x => x.Decommission("u", null)).Should().Throw<BusinessRuleException>()
            .Which.Message.Should().Contain("AssetAlreadyDecommissioned");
    }
}
