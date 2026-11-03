using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;

namespace WaterNetwork.Asset.ContractTests;

public class AssetStatusChangedContractTests
{
    [Fact]
    public void StatusChanged_V1_Schema_Is_Stable()
    {
        var evt = new AssetStatusChangedV1("node-1", "Node", "Active", "Suspended", "reason", "user-7");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Equal("AssetId", "AssetType", "PreviousStatus", "NewStatus", "Reason", "ChangedBy");
    }

    [Fact]
    public void EventType_Constants_Are_Fixed()
    {
        AssetEventTypes.StatusChanged.Should().Be("asset.status.changed");
        AssetEventTypes.Decommissioned.Should().Be("asset.decommissioned");
        AssetEventTypes.TechnicalProfileUpdated.Should().Be("asset.technical-profile.updated");
    }

    [Fact]
    public void Decommissioned_V1_Schema_Is_Stable()
    {
        var evt = new AssetDecommissionedV1("node-1", "Node", "eol", "user-7");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Equal("AssetId", "AssetType", "Reason", "DecommissionedBy");
    }

    [Fact]
    public void TechnicalProfileUpdated_V1_Schema_Is_Stable()
    {
        var evt = new AssetTechnicalProfileUpdatedV1("node-1", "Node", 2019, "Acme", "V-200");
        var props = JsonDocument.Parse(JsonSerializer.Serialize(evt)).RootElement
            .EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().Equal("AssetId", "AssetType", "InstallationYear", "Manufacturer", "Model");
    }
}
