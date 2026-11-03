using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Contract tests for the <c>network.node.relocated</c> v1 integration event.
/// </summary>
public class NetworkNodeRelocatedContractTests
{
    // ── Schema ─────────────────────────────────────────────────────────────────

    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        // Exactly 8 fields — NodeId, TenantId, AssetCode, OldLatitude, OldLongitude,
        // NewLatitude, NewLongitude, Reason.
        var evt = new NetworkNodeRelocatedV1(
            NodeId: "node-001",
            TenantId: "tenant-001",
            AssetCode: "ND-001",
            OldLatitude: 10.0,
            OldLongitude: 106.0,
            NewLatitude: 10.1,
            NewLongitude: 106.1,
            Reason: "Survey correction");

        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        props.Should().BeEquivalentTo(
            "NodeId", "TenantId", "AssetCode",
            "OldLatitude", "OldLongitude", "NewLatitude", "NewLongitude", "Reason");
    }

    [Fact]
    public void V1_Payload_Reason_Is_Nullable()
    {
        // Reason is optional — null must round-trip without error.
        var evt = new NetworkNodeRelocatedV1(
            NodeId: "node-001",
            TenantId: "tenant-001",
            AssetCode: "ND-001",
            OldLatitude: 10.0,
            OldLongitude: 106.0,
            NewLatitude: 10.1,
            NewLongitude: 106.1,
            Reason: null);

        var json = JsonSerializer.Serialize(evt);
        var deserialized = JsonSerializer.Deserialize<NetworkNodeRelocatedV1>(json);
        deserialized!.Reason.Should().BeNull();
    }

    // ── Event type / version ───────────────────────────────────────────────────

    [Fact]
    public void EventType_Const_Is_Fixed()
    {
        GisEventTypes.NodeRelocated.Should().Be("network.node.relocated");
    }

    // ── Mapper: NodeRelocated ─────────────────────────────────────────────────

    [Fact]
    public void Mapper_Translates_NodeRelocated_To_Integration_Event()
    {
        var data = new NodeRelocatedData(
            TenantId: "tenant-001",
            AssetCode: "ND-001",
            OldLatitude: 10.0,
            OldLongitude: 106.0,
            NewLatitude: 10.5,
            NewLongitude: 106.5,
            Reason: "Survey correction");

        var domainEvent = new NodeRelocated("node-42", data);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(domainEvent.EventType).Should().BeTrue();

        var integration = mapper.Map(domainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be(GisEventTypes.NodeRelocated);
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("node-42");
        integration.SourceAggregateType.Should().Be("NetworkNode");

        var typed = integration as NodeRelocatedIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.OccurredAt.Should().Be(domainEvent.OccurredAt);
        typed.Data.NodeId.Should().Be("node-42");
        typed.Data.TenantId.Should().Be("tenant-001");
        typed.Data.AssetCode.Should().Be("ND-001");
        typed.Data.OldLatitude.Should().BeApproximately(10.0, 0.0001);
        typed.Data.OldLongitude.Should().BeApproximately(106.0, 0.0001);
        typed.Data.NewLatitude.Should().BeApproximately(10.5, 0.0001);
        typed.Data.NewLongitude.Should().BeApproximately(106.5, 0.0001);
        typed.Data.Reason.Should().Be("Survey correction");
    }

    [Fact]
    public void Mapper_Translates_NodeRelocated_With_Null_Reason()
    {
        var data = new NodeRelocatedData(
            TenantId: "tenant-001",
            AssetCode: "ND-001",
            OldLatitude: 10.0,
            OldLongitude: 106.0,
            NewLatitude: 10.5,
            NewLongitude: 106.5,
            Reason: null);

        var domainEvent = new NodeRelocated("node-99", data);

        var mapper = new GisIntegrationEventMapper();

        var integration = mapper.Map(domainEvent);
        var typed = integration as NodeRelocatedIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.Data.Reason.Should().BeNull();
    }

    // ── Mapper: regression — existing 3 events still work ─────────────────────

    [Fact]
    public void Mapper_Still_Translates_NodeRegistered_After_Relocated_Support_Added()
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
