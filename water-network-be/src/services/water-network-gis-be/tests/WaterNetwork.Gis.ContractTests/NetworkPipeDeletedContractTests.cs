using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Contract tests for the <c>network.pipe.deleted</c> v1 integration event.
/// </summary>
public class NetworkPipeDeletedContractTests
{
    // ── Schema ─────────────────────────────────────────────────────────────────

    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        // Exactly 3 fields — PipeId, TenantId, AssetCode.
        var evt = new NetworkPipeDeletedV1(
            PipeId: "pipe-001",
            TenantId: "tenant-001",
            AssetCode: "PP-001");

        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        var props = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        props.Should().BeEquivalentTo("PipeId", "TenantId", "AssetCode");
    }

    // ── Event type / version ───────────────────────────────────────────────────

    [Fact]
    public void EventType_Const_Is_Fixed()
    {
        GisEventTypes.PipeDeleted.Should().Be("network.pipe.deleted");
    }

    // ── Mapper: PipeDeleted ────────────────────────────────────────────────────

    [Fact]
    public void Mapper_Translates_PipeDeleted_To_Integration_Event()
    {
        var data = new PipeDeletedData(
            TenantId: "tenant-001",
            AssetCode: "PP-001");

        var domainEvent = new PipeDeleted("pipe-42", data);

        var mapper = new GisIntegrationEventMapper();

        mapper.CanMap(domainEvent.EventType).Should().BeTrue();

        var integration = mapper.Map(domainEvent);
        integration.Should().NotBeNull();
        integration!.EventType.Should().Be(GisEventTypes.PipeDeleted);
        integration.EventVersion.Should().Be(1);
        integration.SourceAggregateId.Should().Be("pipe-42");
        integration.SourceAggregateType.Should().Be("NetworkPipe");

        var typed = integration as PipeDeletedIntegrationEvent;
        typed.Should().NotBeNull();
        typed!.OccurredAt.Should().Be(domainEvent.OccurredAt);
        typed.Data.PipeId.Should().Be("pipe-42");
        typed.Data.TenantId.Should().Be("tenant-001");
        typed.Data.AssetCode.Should().Be("PP-001");
    }

    // ── Mapper: regression — existing 3 events still work ─────────────────────

    [Fact]
    public void Mapper_Still_Translates_PipeRegistered_After_Delete_Support_Added()
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
