using FluentAssertions;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class NetworkNodeTests
{
    [Fact]
    public void Register_Creates_Node_With_NodeRegistered_Event()
    {
        var node = NetworkNode.Register(
            tenantId: "tenant-001",
            assetCode: new AssetCode("ND-001"),
            nodeType: NodeType.Junction,
            location: new GeoPoint(10.762622, 106.660172));

        node.Id.Should().StartWith("node-");
        node.TenantId.Should().Be("tenant-001");
        node.AssetCode.Value.Should().Be("ND-001");
        node.NodeType.Should().Be(NodeType.Junction);
        node.Location.Should().Be(new GeoPoint(10.762622, 106.660172));

        var evt = node.GetDomainEvents().OfType<NodeRegistered>().Single();
        evt.AggregateId.Should().Be(node.Id);
        evt.EventType.Should().Be("NodeRegistered");
        evt.Data.AssetCode.Should().Be("ND-001");
        evt.Data.TenantId.Should().Be("tenant-001");
        evt.Data.Latitude.Should().Be(10.762622);
        evt.Data.Longitude.Should().Be(106.660172);
    }

    [Fact]
    public void Register_Generates_TimeOrdered_UuidV7_Id()
    {
        var first = NetworkNode.Register(
            tenantId: "tenant-001",
            assetCode: new AssetCode("ND-001"),
            nodeType: NodeType.Junction,
            location: new GeoPoint(10.762622, 106.660172));
        Thread.Sleep(2);
        var second = NetworkNode.Register(
            tenantId: "tenant-001",
            assetCode: new AssetCode("ND-002"),
            nodeType: NodeType.Junction,
            location: new GeoPoint(10.762622, 106.660172));

        Guid.ParseExact(first.Id["node-".Length..], "N").Version.Should().Be(7);
        string.CompareOrdinal(first.Id, second.Id).Should().BeNegative(
            "uuid v7 ids generated later must sort after earlier ones");
    }

    [Fact]
    public void Reconstitute_Does_Not_Emit_Events()
    {
        var node = NetworkNode.Reconstitute(
            "node-x", "tenant-001", new AssetCode("ND-001"), NodeType.Junction,
            new GeoPoint(10, 106), version: 3, createdAt: DateTime.UtcNow, updatedAt: DateTime.UtcNow);

        node.GetDomainEvents().Should().BeEmpty();
        node.Version.Should().Be(3);
    }

    [Fact]
    public void Relocate_Changes_Location_And_Bumps_Version()
    {
        var node = NetworkNode.Register("t1", new AssetCode("ND-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));
        node.ClearDomainEvents();
        var before = node.Version;

        node.Relocate(new GeoPoint(10.5, 106.5), reason: "survey fix");

        node.Location.Latitude.Should().Be(10.5);
        node.Location.Longitude.Should().Be(106.5);
        node.Version.Should().Be(before + 1);
    }

    [Fact]
    public void Relocate_Raises_Exactly_One_NodeRelocated_With_Old_And_New()
    {
        var node = NetworkNode.Register("t1", new AssetCode("ND-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));
        node.ClearDomainEvents();

        node.Relocate(new GeoPoint(10.5, 106.5), "survey fix");

        var evt = node.GetDomainEvents().Single().Should().BeOfType<NodeRelocated>().Subject;
        evt.AggregateId.Should().Be(node.Id);
        evt.Data.TenantId.Should().Be("t1");
        evt.Data.AssetCode.Should().Be("ND-1");
        evt.Data.OldLatitude.Should().Be(10.0);
        evt.Data.OldLongitude.Should().Be(106.0);
        evt.Data.NewLatitude.Should().Be(10.5);
        evt.Data.NewLongitude.Should().Be(106.5);
        evt.Data.Reason.Should().Be("survey fix");
    }

    [Fact]
    public void Relocate_To_Same_Location_Throws_NoLocationChange()
    {
        var node = NetworkNode.Register("t1", new AssetCode("ND-1"), NodeType.Junction, new GeoPoint(10.0, 106.0));
        var versionBeforeAttempt = node.Version;
        var act = () => node.Relocate(new GeoPoint(10.0, 106.0), null);
        act.Should().Throw<DomainException>().Which.Code.Should().Contain("NetworkNode.NoLocationChange");
        node.Version.Should().Be(versionBeforeAttempt);
        node.Location.Should().Be(new GeoPoint(10.0, 106.0));
    }
}
