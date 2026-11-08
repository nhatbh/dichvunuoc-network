using FluentAssertions;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

/// <summary>The host rule comes from the component catalog (decision 0028).</summary>
public class DeviceHostTests
{
    private static ComponentCode T(string code) => ComponentCode.Parse(code);

    [Theory]
    [InlineData("GateValve")]
    [InlineData("ButterflyValve")]
    [InlineData("PRV")]
    [InlineData("BulkMeter")]
    [InlineData("Pump")]
    public void PipeHosted_WithPipeOnly_Succeeds(string code)
    {
        var host = DeviceHost.For(T(code), "pipe-1", null);
        host.HostPipeId.Should().Be("pipe-1");
        host.HostNodeId.Should().BeNull();
    }

    [Theory]
    [InlineData("GateValve")]
    [InlineData("BulkMeter")]
    public void PipeHosted_MissingPipe_Throws_HostRequired(string code)
    {
        var act = () => DeviceHost.For(T(code), null, null);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostRequired");
    }

    [Theory]
    [InlineData("GateValve", "pipe-1", "node-1")]
    [InlineData("GateValve", null, "node-1")]
    [InlineData("Pump", null, "node-1")]
    public void PipeHosted_WithNode_Throws_HostNotAllowed(string code, string? pipeId, string? nodeId)
    {
        var act = () => DeviceHost.For(T(code), pipeId, nodeId);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostNotAllowed");
    }

    [Theory]
    [InlineData("Hydrant")]
    [InlineData("AirValve")]
    [InlineData("Washout")]
    [InlineData("PressureSensor")]
    [InlineData("CustomerMeter")]
    public void NodeHosted_WithNodeOnly_Succeeds(string code)
    {
        var host = DeviceHost.For(T(code), null, "node-1");
        host.HostNodeId.Should().Be("node-1");
        host.HostPipeId.Should().BeNull();
    }

    [Theory]
    [InlineData("Hydrant")]
    [InlineData("AirValve")]
    public void NodeHosted_MissingNode_Throws_HostRequired(string code)
    {
        var act = () => DeviceHost.For(T(code), null, null);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostRequired");
    }

    [Theory]
    [InlineData("Hydrant", "pipe-1", "node-1")]
    [InlineData("Hydrant", "pipe-1", null)]
    public void NodeHosted_WithPipe_Throws_HostNotAllowed(string code, string? pipeId, string? nodeId)
    {
        var act = () => DeviceHost.For(T(code), pipeId, nodeId);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.HostNotAllowed");
    }

    [Theory]
    [InlineData("Tee")]
    [InlineData("Reservoir")]
    [InlineData("Pipe")]
    public void Non_Devices_Have_No_Host(string code)
    {
        var act = () => DeviceHost.For(T(code), "pipe-1", null);
        act.Should().Throw<DomainException>().Which.Code.Should().Be("DeviceHost.NotADevice");
    }

    [Fact]
    public void Host_Ids_Are_Trimmed()
        => DeviceHost.For(T("GateValve"), "  pipe-1  ", null).HostPipeId.Should().Be("pipe-1");

    [Fact]
    public void Equality_Ignores_Component_Compares_Host_Refs_Only()
        => DeviceHost.For(T("GateValve"), "pipe-1", null)
            .Should().Be(DeviceHost.For(T("BulkMeter"), "pipe-1", null));
}
