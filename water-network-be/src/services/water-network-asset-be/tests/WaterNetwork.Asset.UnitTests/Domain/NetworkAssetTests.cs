using FluentAssertions;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterNetwork.Asset.Domain.ValueObjects;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class NetworkAssetTests
{
    [Fact]
    public void RegisterFromGis_Reuses_Gis_Id_And_Defaults_To_Active()
    {
        var asset = NetworkAsset.RegisterFromGis("node-abc", "tenant-1", AssetType.Node, "ND-001", "Junction");

        asset.Id.Should().Be("node-abc");
        asset.TenantId.Should().Be("tenant-1");
        asset.AssetType.Should().Be(AssetType.Node);
        asset.AssetCode.Should().Be("ND-001");
        asset.ComponentCode.Should().Be("Junction");
        asset.Status.Should().Be(AssetStatus.Active);
        asset.Version.Should().Be(1);
    }

    [Fact]
    public void RegisterFromGis_Records_Initial_Lifecycle_Entry()
    {
        var asset = NetworkAsset.RegisterFromGis("node-abc", "tenant-1", AssetType.Node, "ND-001", "Junction");

        asset.LifecycleEntries.Should().ContainSingle();
        var entry = asset.LifecycleEntries.Single();
        entry.FromStatus.Should().Be(AssetStatus.Registered);
        entry.ToStatus.Should().Be(AssetStatus.Active);
        entry.Reason.Should().Be("gis-registration");
    }

    [Fact]
    public void RegisterFromGis_Raises_AssetRegistered_Domain_Event()
    {
        var asset = NetworkAsset.RegisterFromGis("node-abc", "tenant-1", AssetType.Node, "ND-001", "Junction");

        var evt = asset.GetDomainEvents().OfType<AssetRegistered>().Single();
        evt.AggregateId.Should().Be("node-abc");
        evt.EventType.Should().Be("AssetRegistered");
        evt.Data.TenantId.Should().Be("tenant-1");
        evt.Data.AssetType.Should().Be("Node");
        evt.Data.AssetCode.Should().Be("ND-001");
        evt.Data.Status.Should().Be("Active");
    }

    [Fact]
    public void RegisterFromGis_Requires_A_Component_Code()
    {
        var act = () => NetworkAsset.RegisterFromGis("node-abc", "tenant-1", AssetType.Node, "ND-001", " ");
        act.Should().Throw<WaterPlatform.BuildingBlocks.Domain.Exceptions.BusinessRuleException>();
    }

    [Fact]
    public void RegisterFromGis_Carries_The_Component_On_The_Event()
    {
        var asset = NetworkAsset.RegisterFromGis("device-1", "tenant-1", AssetType.Device, "DV-001", "ButterflyValve");
        asset.GetDomainEvents().OfType<WaterNetwork.Asset.Domain.DomainEvents.AssetRegistered>().Single()
            .Data.ComponentCode.Should().Be("ButterflyValve");
    }
}
