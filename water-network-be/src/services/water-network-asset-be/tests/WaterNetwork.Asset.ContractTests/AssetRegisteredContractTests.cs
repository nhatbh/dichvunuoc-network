using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;

namespace WaterNetwork.Asset.ContractTests;

public class AssetRegisteredContractTests
{
    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        var evt = new AssetRegisteredV1("node-1", "tenant-1", "Node", "ND-001", "Active");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
        // Order-sensitive: positional records serialize in declaration order, and the
        // asset.registered contract pins property ORDER, not just the property set.
        props.Should().Equal("AssetId", "TenantId", "AssetType", "AssetCode", "Status");
    }

    [Fact]
    public void EventType_Is_Fixed()
        => AssetEventTypes.AssetRegistered.Should().Be("asset.registered");
}
