using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.ContractTests;

public class NetworkNodeRegisteredContractTests
{
    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        var evt = new NetworkNodeRegisteredV1("node-1", "tenant-001", "ND-001", "Junction", 10.76, 106.66);
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
        props.Should().BeEquivalentTo("NodeId", "TenantId", "AssetCode", "NodeType", "Latitude", "Longitude");
    }

    [Fact]
    public void EventType_And_Version_Are_Fixed()
    {
        GisEventTypes.NodeRegistered.Should().Be("network.node.registered");
    }

    [Fact]
    public void Mapper_Translates_NodeRegistered_To_Integration_Event()
    {
        var data = new WaterNetwork.Gis.Domain.DomainEvents.NodeRegisteredData(
            "tenant-001", "ND-001", "Junction", 10.762622, 106.660172);
        var domainEvent = new WaterNetwork.Gis.Domain.DomainEvents.NodeRegistered("node-1", data);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(domainEvent.EventType).Should().BeTrue();
        var integration = mapper.Map(domainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be("network.node.registered");
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("node-1");

        var typed = integration as NodeRegisteredIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.Data.AssetCode.Should().Be("ND-001");
        typed.Data.Latitude.Should().Be(10.762622);
    }

    [Fact]
    public void Mapper_Returns_Null_For_Other_Event()
    {
        var fake = new FakeDomainEvent("SomethingElse");
        var mapper = new GisIntegrationEventMapper();
        mapper.Map(fake).Should().BeNull();
    }

    private sealed record FakeDomainEvent(string EventType)
        : DomainEventBase<string>(
            aggregateId: "id-1",
            aggregateType: "FakeAggregate",
            eventType: EventType,
            data: "data");
}
