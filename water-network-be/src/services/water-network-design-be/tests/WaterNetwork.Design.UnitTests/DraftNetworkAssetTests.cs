// DraftNetworkAssetTests.cs
using FluentAssertions;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class DraftNetworkAssetTests
{
    private static DraftGeometry Point() =>
        new(DraftGeometryType.Point, new[] { new GeoCoordinate(105.8, 21.0) });

    [Fact]
    public void Create_Populates_Fields_And_Generates_Id()
    {
        var d = DraftNetworkAsset.Create(
            "rev-1", "tenant-1", DraftAssetKind.Node, "N-001", clientRef: "c1",
            geometry: Point(), attributes: new Dictionary<string, string> { ["nodeType"] = "Junction" },
            fromRef: null, toRef: null, hostRef: null);

        d.Id.Should().NotBeNullOrEmpty();
        d.RevisionId.Should().Be("rev-1");
        d.Kind.Should().Be(DraftAssetKind.Node);
        d.AssetCode.Should().Be("N-001");
        d.ClientRef.Should().Be("c1");
        d.Attributes.Should().ContainKey("nodeType");
    }

    [Fact]
    public void UpdateGeometry_Replaces_Geometry()
    {
        var d = DraftNetworkAsset.Create(
            "rev-1", "tenant-1", DraftAssetKind.Node, "N-001", null, Point(),
            new Dictionary<string, string>(), null, null, null);

        var newGeom = new DraftGeometry(DraftGeometryType.Point, new[] { new GeoCoordinate(106.0, 20.5) });
        d.UpdateGeometry(newGeom);

        d.Geometry.Coordinates[0].Longitude.Should().Be(106.0);
    }
}
