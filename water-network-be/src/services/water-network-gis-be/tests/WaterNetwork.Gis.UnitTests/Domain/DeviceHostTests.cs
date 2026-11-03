using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class DeviceHostTests
{
    private static DeviceType T(string name) => DeviceType.Parse(name);

    [Theory]
    [InlineData("Valve")]
    [InlineData("FlowMeter")]
    public void PipeHosted_WithPipeOnly_Succeeds(string type)
    {
        var host = DeviceHost.For(T(type), "pipe-1", null);
        host.HostPipeId.Should().Be("pipe-1");
        host.HostNodeId.Should().BeNull();
    }

    [Theory]
    [InlineData("Valve")]
    [InlineData("FlowMeter")]
    public void PipeHosted_MissingPipe_Throws_HostRequired(string type)
    {
        var act = () => DeviceHost.For(T(type), null, null);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostRequired");
    }

    [Theory]
    [InlineData("Valve", "pipe-1", "node-1")]
    [InlineData("Valve", null, "node-1")]
    [InlineData("FlowMeter", "pipe-1", "node-1")]
    public void PipeHosted_WithNode_Throws_HostNotAllowed(string type, string? pipeId, string? nodeId)
    {
        var act = () => DeviceHost.For(T(type), pipeId, nodeId);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostNotAllowed");
    }

    [Theory]
    [InlineData("Pump")]
    [InlineData("Hydrant")]
    public void NodeHosted_WithNodeOnly_Succeeds(string type)
    {
        var host = DeviceHost.For(T(type), null, "node-1");
        host.HostNodeId.Should().Be("node-1");
        host.HostPipeId.Should().BeNull();
    }

    [Theory]
    [InlineData("Pump")]
    [InlineData("Hydrant")]
    public void NodeHosted_MissingNode_Throws_HostRequired(string type)
    {
        var act = () => DeviceHost.For(T(type), null, null);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostRequired");
    }

    [Theory]
    [InlineData("Pump", "pipe-1", "node-1")]
    [InlineData("Hydrant", "pipe-1", null)]
    public void NodeHosted_WithPipe_Throws_HostNotAllowed(string type, string? pipeId, string? nodeId)
    {
        var act = () => DeviceHost.For(T(type), pipeId, nodeId);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostNotAllowed");
    }

    [Fact]
    public void PressureSensor_WithPipeOnly_Succeeds()
        => DeviceHost.For(T("PressureSensor"), "pipe-1", null).HostPipeId.Should().Be("pipe-1");

    [Fact]
    public void PressureSensor_WithNodeOnly_Succeeds()
        => DeviceHost.For(T("PressureSensor"), null, "node-1").HostNodeId.Should().Be("node-1");

    [Fact]
    public void PressureSensor_WithBoth_Throws_AmbiguousHost()
    {
        var act = () => DeviceHost.For(T("PressureSensor"), "pipe-1", "node-1");
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.AmbiguousHost");
    }

    [Fact]
    public void PressureSensor_WithNeither_Throws_HostRequired()
    {
        var act = () => DeviceHost.For(T("PressureSensor"), null, null);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostRequired");
    }

    [Fact]
    public void Whitespace_Host_Is_Treated_As_Null()
    {
        var act = () => DeviceHost.For(T("Valve"), "   ", null);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostRequired");
    }

    [Fact]
    public void Host_Ids_Are_Trimmed()
        => DeviceHost.For(T("Valve"), "  pipe-1  ", null).HostPipeId.Should().Be("pipe-1");

    [Fact]
    public void Equality_Ignores_DeviceType_Compares_Host_Refs_Only()
        => DeviceHost.For(T("Valve"), "pipe-1", null)
            .Should().Be(DeviceHost.For(T("FlowMeter"), "pipe-1", null));
}
