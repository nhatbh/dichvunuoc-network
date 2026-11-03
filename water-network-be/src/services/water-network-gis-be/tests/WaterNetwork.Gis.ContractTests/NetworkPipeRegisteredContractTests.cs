using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Contract tests for the <c>network.pipe.registered</c> v1 integration event.
///
/// <para>
/// <strong>DiameterMm contract type decision: <c>int</c>.</strong><br/>
/// The domain VO (<see cref="WaterNetwork.Gis.Domain.ValueObjects.Diameter"/>) wraps a
/// <c>double</c> internally because the value object arithmetic is float-based, but the
/// physical catalog reality is always whole-millimetre integers (e.g. 150, 200, 300 mm).
/// Persistence already stores <c>int</c> (via <c>Convert.ToInt32</c>). Using <c>int</c> in
/// the public contract surface avoids floating-point noise in downstream consumers and keeps
/// the contract consistent with the database column type. The mapper applies
/// <c>Convert.ToInt32</c> when translating from domain double → contract int.
/// </para>
/// </summary>
public class NetworkPipeRegisteredContractTests
{
    // ── Schema ─────────────────────────────────────────────────────────────────

    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        // Exactly 8 fields — geometry/Points deliberately NOT included
        // (consumers needing geometry must query the read snapshot).
        var evt = new NetworkPipeRegisteredV1(
            PipeId: "pipe-001",
            TenantId: "tenant-001",
            AssetCode: "PP-001",
            FromNodeId: "node-abc",
            ToNodeId: "node-def",
            LengthM: 120.5,
            DiameterMm: 150,
            Material: "HDPE");

        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        props.Should().BeEquivalentTo(
            "PipeId", "TenantId", "AssetCode", "FromNodeId", "ToNodeId",
            "LengthM", "DiameterMm", "Material");
    }

    [Fact]
    public void V1_Payload_Contains_No_Geometry()
    {
        var evt = new NetworkPipeRegisteredV1(
            PipeId: "pipe-001",
            TenantId: "tenant-001",
            AssetCode: "PP-001",
            FromNodeId: "node-abc",
            ToNodeId: "node-def",
            LengthM: 120.5,
            DiameterMm: 150,
            Material: "HDPE");

        var json = JsonSerializer.Serialize(evt);

        // Geometry/Points must NOT appear in the event — consumers query the snapshot
        json.Should().NotContain("Points");
        json.Should().NotContain("Geometry");
        json.Should().NotContain("Coordinates");
    }

    // ── Event type / version ───────────────────────────────────────────────────

    [Fact]
    public void EventType_And_Version_Are_Fixed()
    {
        GisEventTypes.PipeRegistered.Should().Be("network.pipe.registered");
    }

    // ── Mapper: PipeRegistered ─────────────────────────────────────────────────

    [Fact]
    public void Mapper_Translates_PipeRegistered_To_Integration_Event()
    {
        var data = new WaterNetwork.Gis.Domain.DomainEvents.PipeRegisteredData(
            TenantId: "tenant-001",
            AssetCode: "PP-001",
            FromNodeId: "node-abc",
            ToNodeId: "node-def",
            Points: new[]
            {
                new WaterNetwork.Gis.Domain.ValueObjects.GeoPoint(10.762622, 106.660172),
                new WaterNetwork.Gis.Domain.ValueObjects.GeoPoint(10.763000, 106.661000)
            },
            DiameterMm: 150.0,   // domain is double
            Material: "HDPE",
            LengthM: 120.5);

        var domainEvent = new WaterNetwork.Gis.Domain.DomainEvents.PipeRegistered("pipe-001", data);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(domainEvent.EventType).Should().BeTrue();

        var integration = mapper.Map(domainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be("network.pipe.registered");
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("pipe-001");
        integration.SourceAggregateType.Should().Be("NetworkPipe");

        var typed = integration as PipeRegisteredIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.Data.AssetCode.Should().Be("PP-001");
        typed.Data.FromNodeId.Should().Be("node-abc");
        typed.Data.ToNodeId.Should().Be("node-def");
        typed.Data.DiameterMm.Should().Be(150);   // contract is int
        typed.Data.Material.Should().Be("HDPE");
        typed.Data.LengthM.Should().BeApproximately(120.5, 0.001);
    }

    // ── Mapper: regression — NodeRegistered still works ───────────────────────

    [Fact]
    public void Mapper_Still_Translates_NodeRegistered_After_Pipe_Support_Added()
    {
        var nodeData = new WaterNetwork.Gis.Domain.DomainEvents.NodeRegisteredData(
            "tenant-001", "ND-001", "Junction", 10.762622, 106.660172);
        var nodeDomainEvent = new WaterNetwork.Gis.Domain.DomainEvents.NodeRegistered("node-1", nodeData);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(nodeDomainEvent.EventType).Should().BeTrue();
        var integration = mapper.Map(nodeDomainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be("network.node.registered");
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
        var fake = new FakeDomainEvent("SomethingElse");
        var mapper = new GisIntegrationEventMapper();
        mapper.Map(fake).Should().BeNull();
    }

    [Fact]
    public void Mapper_CanMap_Returns_False_For_Unknown_Event()
    {
        var mapper = new GisIntegrationEventMapper();
        mapper.CanMap("SomethingEntirelyUnknown").Should().BeFalse();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private sealed record FakeDomainEvent(string EventType)
        : DomainEventBase<string>(
            aggregateId: "id-1",
            aggregateType: "FakeAggregate",
            eventType: EventType,
            data: "data");
}
