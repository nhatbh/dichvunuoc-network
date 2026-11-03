using FluentAssertions;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterNetwork.Gis.Domain.ValueObjects;
using Xunit;

namespace WaterNetwork.Gis.UnitTests;

public sealed class DraftAssetMapperTests
{
    private static readonly IReadOnlyList<double> NodeCoord = new double[] { 106.7, 10.8 };
    private static readonly IReadOnlyList<IReadOnlyList<double>> NodeCoords = new[] { NodeCoord };

    private static ReadyForGisAssetV1 Node() => new(
        "d1", "Node", "N-1", "cr-node",
        new ReadyForGisGeometryV1("Point", NodeCoords),
        new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null);

    [Fact]
    public void Maps_node_with_correct_coordinate_order()
    {
        var (geoPoint, nodeType) = DraftAssetMapper.MapNode(Node());
        geoPoint.Latitude.Should().Be(10.8);
        geoPoint.Longitude.Should().Be(106.7);
        nodeType.Should().Be(NodeType.Junction);
    }

    [Fact]
    public void Node_missing_nodeType_throws_DraftMappingException()
    {
        var bad = Node() with { Attributes = new Dictionary<string, string>() };
        var act = () => DraftAssetMapper.MapNode(bad);
        act.Should().Throw<DraftMappingException>().WithMessage("*nodeType*");
    }

    [Fact]
    public void Maps_pipe_resolving_endpoints_from_clientRef_map()
    {
        var pipeCoords = new IReadOnlyList<double>[]
        {
            new double[] { 106.7, 10.8 },
            new double[] { 106.71, 10.81 }
        };
        var pipe = new ReadyForGisAssetV1("d3", "Pipe", "P-1", "cr-pipe",
            new ReadyForGisGeometryV1("LineString", pipeCoords),
            new Dictionary<string, string> { ["diameterMm"] = "110", ["material"] = "PVC" },
            FromRef: "cr-a", ToRef: "cr-b", HostRef: null);
        var map = new Dictionary<string, string> { ["cr-a"] = "node-a", ["cr-b"] = "node-b" };
        var m = DraftAssetMapper.MapPipe(pipe, map);
        m.FromNodeId.Should().Be("node-a");
        m.ToNodeId.Should().Be("node-b");
        m.Points.Should().HaveCount(2);
        m.Points[0].Latitude.Should().Be(10.8);
        m.DiameterMm.Should().Be(110);
        m.Material.Should().Be("PVC");
        m.LengthM.Should().BeNull();
    }

    [Fact]
    public void Pipe_unresolved_endpoint_throws()
    {
        var pipeCoords = new IReadOnlyList<double>[]
        {
            new double[] { 1, 2 },
            new double[] { 3, 4 }
        };
        var pipe = new ReadyForGisAssetV1("d3", "Pipe", "P-1", null,
            new ReadyForGisGeometryV1("LineString", pipeCoords),
            new Dictionary<string, string> { ["diameterMm"] = "110", ["material"] = "PVC" },
            "cr-missing", "cr-b", null);
        var act = () => DraftAssetMapper.MapPipe(pipe, new Dictionary<string, string> { ["cr-b"] = "node-b" });
        act.Should().Throw<DraftMappingException>().WithMessage("*cr-missing*");
    }

    [Fact]
    public void Maps_device_resolving_host()
    {
        var device = new ReadyForGisAssetV1("d4", "Device", "V-1", "cr-dev",
            new ReadyForGisGeometryV1("Point", NodeCoords),
            new Dictionary<string, string> { ["deviceType"] = "Valve" },
            null, null, HostRef: "cr-pipe");
        var map = new Dictionary<string, string> { ["cr-pipe"] = "pipe-1" };
        var m = DraftAssetMapper.MapDevice(device, map);
        m.DeviceType.Should().Be("Valve");
        m.HostPipeOrNodeId.Should().Be("pipe-1");
        m.Location.Latitude.Should().Be(10.8);
    }
}
