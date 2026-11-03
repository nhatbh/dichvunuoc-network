using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;
using Xunit;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Consumer-side contract: GIS-5 depends on these exact payload shapes + event-type constants.
/// If asset-be changes them, this test fails and forces a coordinated version bump.
/// </summary>
public class AssetLifecycleConsumerContractTests
{
    [Fact]
    public void EventTypes_Consumed_By_Gis_Are_Fixed()
    {
        AssetEventTypes.AssetRegistered.Should().Be("asset.registered");
        AssetEventTypes.StatusChanged.Should().Be("asset.status.changed");
    }

    [Fact]
    public void AssetRegisteredV1_Has_Fields_Gis_Reads()
    {
        var evt = new AssetRegisteredV1("a", "t", "Node", "ND-1", "Active");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Contain(["AssetId", "AssetType", "Status"]);
    }

    [Fact]
    public void AssetStatusChangedV1_Has_Fields_Gis_Reads()
    {
        var evt = new AssetStatusChangedV1("a", "Node", "Active", "Suspended", null, "op");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Contain(["AssetId", "AssetType", "NewStatus"]);
    }
}
