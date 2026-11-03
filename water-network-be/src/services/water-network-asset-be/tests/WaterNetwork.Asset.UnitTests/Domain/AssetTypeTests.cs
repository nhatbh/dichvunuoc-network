using FluentAssertions;
using WaterNetwork.Asset.Domain.ValueObjects;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class AssetTypeTests
{
    [Theory]
    [InlineData("network.node.registered", AssetType.Node)]
    [InlineData("network.pipe.registered", AssetType.Pipe)]
    [InlineData("network.device.installed", AssetType.Device)]
    public void FromGisEventType_Maps_Each_Registration_Event(string eventType, AssetType expected)
        => AssetTypeMapping.FromGisEventType(eventType).Should().Be(expected);

    [Fact]
    public void FromGisEventType_Returns_Null_For_Unknown_Event()
        => AssetTypeMapping.FromGisEventType("network.node.deleted").Should().BeNull();
}
