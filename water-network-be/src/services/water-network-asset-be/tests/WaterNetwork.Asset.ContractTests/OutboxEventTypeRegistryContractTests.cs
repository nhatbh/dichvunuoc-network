using FluentAssertions;
using WaterNetwork.Asset.Domain.DomainEvents;

namespace WaterNetwork.Asset.ContractTests;

public class OutboxEventTypeRegistryContractTests
{
    [Fact]
    public void AssetRegistered_EventType_Matches_Type_Name()
    {
        // OutboxProcessor resolves concrete domain events by Type.Name; the domain event's
        // EventType string MUST equal it, or the typed mapper never matches.
        typeof(AssetRegistered).Name.Should().Be("AssetRegistered");
        var data = new AssetRegisteredData("t", "Node", "ND-001", "Active");
        new AssetRegistered("node-1", data).EventType.Should().Be("AssetRegistered");
    }
}
