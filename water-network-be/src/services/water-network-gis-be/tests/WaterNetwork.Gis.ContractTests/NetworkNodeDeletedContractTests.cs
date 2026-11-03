using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Contract tests for the <c>network.node.deleted</c> v1 integration event.
/// </summary>
public class NetworkNodeDeletedContractTests
{
    // ── Schema ─────────────────────────────────────────────────────────────────

    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        // Exactly 4 fields — NodeId, TenantId, AssetCode, NodeType.
        var evt = new NetworkNodeDeletedV1(
            NodeId: "node-001",
            TenantId: "tenant-001",
            AssetCode: "ND-001",
            NodeType: "Junction");

        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        props.Should().BeEquivalentTo("NodeId", "TenantId", "AssetCode", "NodeType");
    }

    // ── Event type / version ───────────────────────────────────────────────────

    [Fact]
    public void EventType_Const_Is_Fixed()
    {
        GisEventTypes.NodeDeleted.Should().Be("network.node.deleted");
    }

    // ── Mapper: NodeDeleted ────────────────────────────────────────────────────

    [Fact]
    public void Mapper_Translates_NodeDeleted_To_Integration_Event()
    {
        var data = new NodeDeletedData(
            TenantId: "tenant-001",
            AssetCode: "ND-001",
            NodeType: "Junction");

        var domainEvent = new NodeDeleted("node-42", data);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(domainEvent.EventType).Should().BeTrue();

        var integration = mapper.Map(domainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be(GisEventTypes.NodeDeleted);
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("node-42");
        integration.SourceAggregateType.Should().Be("NetworkNode");

        var typed = integration as NodeDeletedIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.OccurredAt.Should().Be(domainEvent.OccurredAt);
        typed.Data.NodeId.Should().Be("node-42");
        typed.Data.TenantId.Should().Be("tenant-001");
        typed.Data.AssetCode.Should().Be("ND-001");
        typed.Data.NodeType.Should().Be("Junction");
    }

    // ── Mapper: regression — existing 3 events still work ─────────────────────

    [Fact]
    public void Mapper_Still_Translates_NodeRegistered_After_Delete_Support_Added()
    {
        var nodeData = new NodeRegisteredData(
            "tenant-001", "ND-001", "Junction", 10.762622, 106.660172);
        var nodeDomainEvent = new NodeRegistered("node-1", nodeData);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(nodeDomainEvent.EventType).Should().BeTrue();
        var integration = mapper.Map(nodeDomainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be(GisEventTypes.NodeRegistered);
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("node-1");

        var typed = integration as NodeRegisteredIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.Data.AssetCode.Should().Be("ND-001");
    }

    // ── Mapper: CanMap ─────────────────────────────────────────────────────────

    [Fact]
    public void Mapper_CanMap_Returns_True_For_All_Registered_Events()
    {
        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap("NodeRegistered").Should().BeTrue();
        mapper.CanMap("PipeRegistered").Should().BeTrue();
        mapper.CanMap("DeviceInstalled").Should().BeTrue();
        mapper.CanMap("NodeDeleted").Should().BeTrue();
        mapper.CanMap("PipeDeleted").Should().BeTrue();
        mapper.CanMap("DeviceDeleted").Should().BeTrue();
        mapper.CanMap("NodeRelocated").Should().BeTrue();
    }

    // ── Mapper: unknown event → null ──────────────────────────────────────────

    [Fact]
    public void Mapper_Returns_Null_For_Unknown_Event()
    {
        var fake = new FakeDomainEvent("SomethingUnknown");
        var mapper = new GisIntegrationEventMapper();
        mapper.Map(fake).Should().BeNull();
    }

    [Fact]
    public void Mapper_CanMap_Returns_False_For_Unknown_Event()
    {
        var mapper = new GisIntegrationEventMapper();
        mapper.CanMap("nope").Should().BeFalse();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private sealed record FakeDomainEvent(string EventType)
        : DomainEventBase<string>(
            aggregateId: "id-fake",
            aggregateType: "FakeAggregate",
            eventType: EventType,
            data: "data");
}
