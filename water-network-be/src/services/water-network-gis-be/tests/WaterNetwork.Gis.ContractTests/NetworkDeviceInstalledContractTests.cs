using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Contract tests for the <c>network.device.installed</c> v1 integration event.
///
/// <para>
/// The device location (a single point) IS included in the payload — it is cheap and
/// most consumers (asset, observation, topology) want it. Exactly one of
/// <c>HostPipeId</c>/<c>HostNodeId</c> is non-null, enforced upstream by the DeviceHost
/// domain rule per device type.
/// </para>
/// </summary>
public class NetworkDeviceInstalledContractTests
{
    // ── Schema ─────────────────────────────────────────────────────────────────

    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        // Exactly 8 fields — wire property names pinned via JSON serialization,
        // none may be added/removed silently.
        var evt = new NetworkDeviceInstalledV1(
            DeviceId: "device-001",
            TenantId: "tenant-001",
            AssetCode: "DV-001",
            DeviceType: "Valve",
            HostPipeId: "pipe-1",
            HostNodeId: null,
            Latitude: 10.0,
            Longitude: 106.0);

        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        props.Should().BeEquivalentTo(
            "DeviceId", "TenantId", "AssetCode", "DeviceType",
            "HostPipeId", "HostNodeId", "Latitude", "Longitude");
    }

    // ── Event type / version ───────────────────────────────────────────────────

    [Fact]
    public void EventType_Const_Is_Fixed()
    {
        GisEventTypes.DeviceInstalled.Should().Be("network.device.installed");
    }

    // ── Mapper: DeviceInstalled ────────────────────────────────────────────────

    [Fact]
    public void Mapper_Translates_DeviceInstalled_To_Integration_Event()
    {
        var data = new DeviceInstalledData(
            TenantId: "tenant-001",
            AssetCode: "DV-001",
            DeviceType: "Valve",
            HostPipeId: "pipe-1",
            HostNodeId: null,
            Latitude: 10.0,
            Longitude: 106.0);

        var domainEvent = new DeviceInstalled("device-1", data);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(domainEvent.EventType).Should().BeTrue();

        var integration = mapper.Map(domainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be(GisEventTypes.DeviceInstalled);
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("device-1");
        integration.SourceAggregateType.Should().Be("NetworkDevice");

        var typed = integration as DeviceInstalledIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.OccurredAt.Should().Be(domainEvent.OccurredAt);
        typed.Data.DeviceId.Should().Be("device-1");
        typed.Data.TenantId.Should().Be("tenant-001");
        typed.Data.AssetCode.Should().Be("DV-001");
        typed.Data.DeviceType.Should().Be("Valve");
        typed.Data.HostPipeId.Should().Be("pipe-1");
        typed.Data.HostNodeId.Should().BeNull();
        typed.Data.Latitude.Should().BeApproximately(10.0, 0.0001);
        typed.Data.Longitude.Should().BeApproximately(106.0, 0.0001);
    }

    // ── Mapper: regression — NodeRegistered and PipeRegistered still work ──────

    [Fact]
    public void Mapper_Still_Translates_NodeRegistered_After_Device_Support_Added()
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

    [Fact]
    public void Mapper_Still_Translates_PipeRegistered_After_Device_Support_Added()
    {
        var pipeData = new PipeRegisteredData(
            TenantId: "tenant-001",
            AssetCode: "PP-001",
            FromNodeId: "node-abc",
            ToNodeId: "node-def",
            Points: new[]
            {
                new WaterNetwork.Gis.Domain.ValueObjects.GeoPoint(10.762622, 106.660172),
                new WaterNetwork.Gis.Domain.ValueObjects.GeoPoint(10.763000, 106.661000)
            },
            DiameterMm: 150.0,
            Material: "HDPE",
            LengthM: 120.5);

        var pipeDomainEvent = new PipeRegistered("pipe-001", pipeData);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(pipeDomainEvent.EventType).Should().BeTrue();
        var integration = mapper.Map(pipeDomainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be(GisEventTypes.PipeRegistered);
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("pipe-001");

        var typed = integration as PipeRegisteredIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.Data.AssetCode.Should().Be("PP-001");
        typed.Data.DiameterMm.Should().Be(150);
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

    [Fact]
    public void Mapper_CanMap_Returns_False_For_Unknown_Event()
    {
        var mapper = new GisIntegrationEventMapper();
        mapper.CanMap("Unknown").Should().BeFalse();
    }

    // ── Mapper: unknown event → null ──────────────────────────────────────────

    [Fact]
    public void Mapper_Returns_Null_For_Unknown_Event()
    {
        var fake = new FakeDomainEvent("SomethingUnknown");
        var mapper = new GisIntegrationEventMapper();
        mapper.Map(fake).Should().BeNull();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private sealed record FakeDomainEvent(string EventType)
        : DomainEventBase<string>(
            aggregateId: "id-fake",
            aggregateType: "FakeAggregate",
            eventType: EventType,
            data: "data");
}
