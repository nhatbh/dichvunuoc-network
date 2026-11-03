using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Contract tests for the <c>network.device.deleted</c> v1 integration event.
/// </summary>
public class NetworkDeviceDeletedContractTests
{
    // ── Schema ─────────────────────────────────────────────────────────────────

    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        // Exactly 4 fields — DeviceId, TenantId, AssetCode, DeviceType.
        var evt = new NetworkDeviceDeletedV1(
            DeviceId: "device-001",
            TenantId: "tenant-001",
            AssetCode: "DV-001",
            DeviceType: "Valve");

        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        props.Should().BeEquivalentTo("DeviceId", "TenantId", "AssetCode", "DeviceType");
    }

    // ── Event type / version ───────────────────────────────────────────────────

    [Fact]
    public void EventType_Const_Is_Fixed()
    {
        GisEventTypes.DeviceDeleted.Should().Be("network.device.deleted");
    }

    // ── Mapper: DeviceDeleted ─────────────────────────────────────────────────

    [Fact]
    public void Mapper_Translates_DeviceDeleted_To_Integration_Event()
    {
        var data = new DeviceDeletedData(
            TenantId: "tenant-001",
            AssetCode: "DV-001",
            DeviceType: "Valve");

        var domainEvent = new DeviceDeleted("device-42", data);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(domainEvent.EventType).Should().BeTrue();

        var integration = mapper.Map(domainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be(GisEventTypes.DeviceDeleted);
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("device-42");
        integration.SourceAggregateType.Should().Be("NetworkDevice");

        var typed = integration as DeviceDeletedIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.OccurredAt.Should().Be(domainEvent.OccurredAt);
        typed.Data.DeviceId.Should().Be("device-42");
        typed.Data.TenantId.Should().Be("tenant-001");
        typed.Data.AssetCode.Should().Be("DV-001");
        typed.Data.DeviceType.Should().Be("Valve");
    }

    // ── Mapper: regression — existing 3 events still work ─────────────────────

    [Fact]
    public void Mapper_Still_Translates_DeviceInstalled_After_Delete_Support_Added()
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

        var typed = integration as DeviceInstalledIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.Data.AssetCode.Should().Be("DV-001");
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
