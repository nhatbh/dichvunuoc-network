using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Design.Contracts.Events;
using Xunit;

namespace WaterNetwork.Design.ContractTests;

public sealed class DesignPublishEventsContractTests
{
    [Fact]
    public void ReadyForGis_v1_serializes_expected_fields()
    {
        double[] coords = [106.7, 10.8];
        var payload = new DesignAssetReadyForGisV1(
            "rev-1", "proj-1", "tenant-1", 2, "user-1",
            new[]
            {
                new ReadyForGisAssetV1("d1", "Node", "N-1", "cr-1",
                    new ReadyForGisGeometryV1("Point", new[] { coords }),
                    new Dictionary<string, string> { ["nodeType"] = "Junction" },
                    null, null, null)
            });

        var json = JsonSerializer.Serialize(payload);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        root.GetProperty("RevisionId").GetString().Should().Be("rev-1");
        root.GetProperty("ApprovedBy").GetString().Should().Be("user-1");
        var asset = root.GetProperty("Assets")[0];
        asset.GetProperty("Kind").GetString().Should().Be("Node");
        asset.GetProperty("Geometry").GetProperty("Type").GetString().Should().Be("Point");
        asset.GetProperty("Geometry").GetProperty("Coordinates")[0][0].GetDouble().Should().Be(106.7);
        asset.GetProperty("Attributes").GetProperty("nodeType").GetString().Should().Be("Junction");
    }

    [Fact]
    public void RevisionPublished_v1_serializes_expected_fields()
    {
        var payload = new DesignRevisionPublishedV1("rev-1", "proj-1", "tenant-1", 2, "importer", "PartiallyPublished", 3, 1);
        var json = JsonSerializer.Serialize(payload);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        root.GetProperty("ActorId").GetString().Should().Be("importer");
        root.GetProperty("Status").GetString().Should().Be("PartiallyPublished");
        root.GetProperty("ImportedCount").GetInt32().Should().Be(3);
        root.GetProperty("FailedCount").GetInt32().Should().Be(1);
    }
}
