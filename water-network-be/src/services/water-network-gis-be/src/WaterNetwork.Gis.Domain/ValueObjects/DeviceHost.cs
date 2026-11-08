using WaterPlatform.BuildingBlocks.Components;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

/// <summary>
/// Host attachment of a device, from its component's catalog host rule (decision 0028):
/// in-line components (valves, meters, pumps, strainers) → hostPipeId only; point devices
/// (hydrants, air valves, washouts, sensors, customer meters) → hostNodeId only. Extra host refs
/// are rejected, never silently ignored.
/// </summary>
public sealed class DeviceHost : ValueObject
{
    public string? HostPipeId { get; }
    public string? HostNodeId { get; }

    private DeviceHost(string? hostPipeId, string? hostNodeId)
    {
        HostPipeId = hostPipeId;
        HostNodeId = hostNodeId;
    }

    public static DeviceHost For(ComponentCode device, string? hostPipeId, string? hostNodeId)
    {
        var pipeId = Normalize(hostPipeId);
        var nodeId = Normalize(hostNodeId);

        return device.Definition.Host switch
        {
            ComponentHosts.Pipe => PipeHosted(device, pipeId, nodeId),
            ComponentHosts.Node => NodeHosted(device, pipeId, nodeId),
            _ => throw new DomainException("DeviceHost.NotADevice",
                $"'{device}' is not a device; it has no host.")
        };
    }

    private static string? Normalize(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static DeviceHost PipeHosted(ComponentCode type, string? pipeId, string? nodeId)
    {
        if (nodeId is not null)
            throw new DomainException("DeviceHost.HostNotAllowed",
                $"A {type} attaches to a pipe only; hostNodeId must not be provided.");
        if (pipeId is null)
            throw new DomainException("DeviceHost.HostRequired",
                $"A {type} requires hostPipeId.");
        return new DeviceHost(pipeId, null);
    }

    private static DeviceHost NodeHosted(ComponentCode type, string? pipeId, string? nodeId)
    {
        if (pipeId is not null)
            throw new DomainException("DeviceHost.HostNotAllowed",
                $"A {type} attaches to a node only; hostPipeId must not be provided.");
        if (nodeId is null)
            throw new DomainException("DeviceHost.HostRequired",
                $"A {type} requires hostNodeId.");
        return new DeviceHost(null, nodeId);
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        // DeviceType is intentionally excluded: two devices of different types
        // on the same pipe/node share the same host attachment identity.
        yield return HostPipeId;
        yield return HostNodeId;
    }
}
