using FluentAssertions;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class GeometryVersionTests
{
    private static readonly AssetKind NodeKind = AssetKind.Parse("Node");
    private const string SampleGeoJson = """{"type":"Point","coordinates":[106.66,10.76]}""";

    [Fact]
    public void Create_Assigns_Fields_Correctly()
    {
        var before = DateTime.UtcNow;

        var gv = GeometryVersion.Create(
            assetId:   "node-abc",
            assetKind: NodeKind,
            version:   1,
            geoJson:   SampleGeoJson,
            changedBy: "user-1",
            reason:    "initial placement");

        gv.Id.Should().StartWith("geomver-");
        gv.AssetId.Should().Be("node-abc");
        gv.AssetKind.Should().Be(NodeKind);
        gv.Version.Should().Be(1);
        gv.GeoJson.Should().Be(SampleGeoJson);
        gv.ChangedBy.Should().Be("user-1");
        gv.Reason.Should().Be("initial placement");
        gv.ChangedAt.Should().BeOnOrAfter(before).And.BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t")]
    public void Empty_AssetId_Throws_DomainException(string badAssetId)
    {
        var act = () => GeometryVersion.Create(badAssetId, NodeKind, 1, SampleGeoJson);
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("GeometryVersion.InvalidAssetId");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public void Version_Less_Than_One_Throws_DomainException(int badVersion)
    {
        var act = () => GeometryVersion.Create("node-abc", NodeKind, badVersion, SampleGeoJson);
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("GeometryVersion.InvalidVersion");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t")]
    public void Empty_GeoJson_Throws_DomainException(string badGeoJson)
    {
        var act = () => GeometryVersion.Create("node-abc", NodeKind, 1, badGeoJson);
        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("GeometryVersion.EmptyGeometry");
    }

    [Fact]
    public void Is_Append_Only_No_Public_Setters()
    {
        // Verify compile-shape: all properties are get-only (no public set).
        var props = typeof(GeometryVersion).GetProperties();
        foreach (var prop in props)
        {
            prop.SetMethod?.IsPublic.Should().BeFalse(
                $"GeometryVersion.{prop.Name} must not have a public setter (append-only)");
        }
    }

    [Fact]
    public void Reconstitute_Returns_Instance_With_Given_Values()
    {
        var id = "geomver-fixed";
        var changedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var gv = GeometryVersion.Reconstitute(
            id:        id,
            assetId:   "pipe-xyz",
            assetKind: AssetKind.Parse("Pipe"),
            version:   3,
            geoJson:   SampleGeoJson,
            changedBy: "sys",
            reason:    "relocate",
            changedAt: changedAt);

        gv.Id.Should().Be(id);
        gv.AssetId.Should().Be("pipe-xyz");
        gv.AssetKind.ToString().Should().Be("Pipe");
        gv.Version.Should().Be(3);
        gv.GeoJson.Should().Be(SampleGeoJson);
        gv.ChangedBy.Should().Be("sys");
        gv.Reason.Should().Be("relocate");
        gv.ChangedAt.Should().Be(changedAt);
    }
}
