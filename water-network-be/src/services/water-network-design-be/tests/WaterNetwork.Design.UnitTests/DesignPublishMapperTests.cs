using FluentAssertions;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterNetwork.Design.Infrastructure.IntegrationEvents;
using Xunit;

namespace WaterNetwork.Design.UnitTests;

public sealed class DesignPublishMapperTests
{
    private readonly DesignIntegrationEventMapper _mapper = new();

    [Fact]
    public void Maps_DesignAssetReadyForGis_to_integration_event()
    {
        var coords = new IReadOnlyList<double>[] { new double[] { 106.7, 10.8 } };
        var evt = new DesignAssetReadyForGis("rev-1", new DesignAssetReadyForGisData(
            "proj-1", "tenant-1", 1, "approver",
            new[] { new DraftAssetSnapshot("d1", "Node", "N-1", null,
                new DraftGeometrySnapshot("Point", coords),
                new Dictionary<string, string>(), null, null, null) }));

        _mapper.CanMap(nameof(DesignAssetReadyForGis)).Should().BeTrue();
        var ie = _mapper.Map(evt);
        ie!.EventType.Should().Be(DesignEventTypes.AssetReadyForGis);
    }

    [Fact]
    public void Maps_DesignRevisionPublished_to_integration_event()
    {
        var evt = new DesignRevisionPublished("rev-1",
            new DesignRevisionPublishedData("proj-1", "tenant-1", 1, "actor-1", "Published", 2, 0));
        _mapper.Map(evt)!.EventType.Should().Be(DesignEventTypes.RevisionPublished);
    }
}
