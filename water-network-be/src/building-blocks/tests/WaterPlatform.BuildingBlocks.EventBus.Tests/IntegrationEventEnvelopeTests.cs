using System.Text.Json;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using Xunit;

namespace WaterPlatform.BuildingBlocks.EventBus.Tests;

public class IntegrationEventEnvelopeTests
{
    [Fact]
    public void Envelope_Round_Trips_Through_Json()
    {
        var envelope = new IntegrationEventEnvelope(
            "evt-1", "network.node.registered", 1, new DateTime(2026, 6, 11, 0, 0, 0, DateTimeKind.Utc),
            "tenant-001", "org-001", "branch-001", "corr-1", "cause-1", "water-network-gis-be", "{\"a\":1}");

        var json = JsonSerializer.Serialize(envelope);
        var back = JsonSerializer.Deserialize<IntegrationEventEnvelope>(json);

        back.Should().Be(envelope);
    }

    [Fact]
    public void Envelope_Json_Contains_Spec_Fields()
    {
        var envelope = new IntegrationEventEnvelope(
            "evt-1", "t", 1, DateTime.UtcNow, null, null, null, null, null, "p", "{}");
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(envelope));
        var names = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
        names.Should().Contain(["EventId", "EventType", "EventVersion", "OccurredAt", "TenantId",
            "OrganizationId", "BranchId", "CorrelationId", "CausationId", "Producer", "Payload"]);
    }
}
