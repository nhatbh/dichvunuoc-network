using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using Xunit;

namespace WaterNetwork.Gis.UnitTests;

public sealed class GisImportCompletedMapperTests
{
    [Fact]
    public void Maps_NetworkGisImportCompleted_to_integration_event()
    {
        var evt = new NetworkGisImportCompleted("rev-1", new NetworkGisImportCompletedData(
            "rev-1", "tenant-1",
            new[] { new GisImportedAsset("d1", "node-x", "Node", "N-1") },
            new[] { new GisImportFailure("d2", "P-1", "duplicate") }));

        var mapper = new GisIntegrationEventMapper();
        mapper.CanMap(nameof(NetworkGisImportCompleted)).Should().BeTrue();
        var ie = mapper.Map(evt);
        ie!.EventType.Should().Be(GisEventTypes.GisImportCompleted);
    }
}
