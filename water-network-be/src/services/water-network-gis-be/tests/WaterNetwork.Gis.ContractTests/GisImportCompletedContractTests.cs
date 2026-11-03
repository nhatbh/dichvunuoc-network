using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Gis.Contracts.Events;
using Xunit;

namespace WaterNetwork.Gis.ContractTests;

public sealed class GisImportCompletedContractTests
{
    [Fact]
    public void GisImportCompleted_v1_serializes_expected_fields()
    {
        var payload = new NetworkGisImportCompletedV1(
            "rev-1", "tenant-1",
            new[] { new GisImportedAssetV1("d1", "node-abc", "Node", "N-1") },
            new[] { new GisImportFailureV1("d2", "P-1", "AssetCode 'P-1' already exists in GIS.") });

        var json = JsonSerializer.Serialize(payload);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        root.GetProperty("Imported")[0].GetProperty("GisAssetId").GetString().Should().Be("node-abc");
        root.GetProperty("Failed")[0].GetProperty("Reason").GetString().Should().Contain("already exists");
    }
}
