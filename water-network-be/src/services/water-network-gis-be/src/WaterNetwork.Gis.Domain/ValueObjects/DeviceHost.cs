using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

/// <summary>
/// Host attachment of a device, validated against the per-type host matrix:
/// Valve/FlowMeter → hostPipeId only; Pump/Hydrant → hostNodeId only;
/// PressureSensor → exactly one of the two. Extra host refs are rejected,
/// never silently ignored.
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

    public static DeviceHost For(DeviceType deviceType, string? hostPipeId, string? hostNodeId)
    {
        var pipeId = Normalize(hostPipeId);
        var nodeId = Normalize(hostNodeId);

        return deviceType.ToString() switch
        {
            "Valve" or "FlowMeter" => PipeHosted(deviceType, pipeId, nodeId),
            "Pump" or "Hydrant" => NodeHosted(deviceType, pipeId, nodeId),
            "PressureSensor" => EitherHosted(deviceType, pipeId, nodeId),
            // Unreachable: DeviceType.Parse only yields the 5 canonical values above.
            _ => throw new DomainException("DeviceHost.UnknownDeviceType",
                $"'{deviceType}' has no host rule defined.")
        };
    }

    private static string? Normalize(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static DeviceHost PipeHosted(DeviceType type, string? pipeId, string? nodeId)
    {
        if (nodeId is not null)
            throw new DomainException("DeviceHost.HostNotAllowed",
                $"A {type} attaches to a pipe only; hostNodeId must not be provided.");
        if (pipeId is null)
            throw new DomainException("DeviceHost.HostRequired",
                $"A {type} requires hostPipeId.");
        return new DeviceHost(pipeId, null);
    }

    private static DeviceHost NodeHosted(DeviceType type, string? pipeId, string? nodeId)
    {
        if (pipeId is not null)
            throw new DomainException("DeviceHost.HostNotAllowed",
                $"A {type} attaches to a node only; hostPipeId must not be provided.");
        if (nodeId is null)
            throw new DomainException("DeviceHost.HostRequired",
                $"A {type} requires hostNodeId.");
        return new DeviceHost(null, nodeId);
    }

    private static DeviceHost EitherHosted(DeviceType type, string? pipeId, string? nodeId)
    {
        if (pipeId is not null && nodeId is not null)
            throw new DomainException("DeviceHost.AmbiguousHost",
                $"A {type} must reference exactly one of hostPipeId or hostNodeId, not both.");
        if (pipeId is null && nodeId is null)
            throw new DomainException("DeviceHost.HostRequired",
                $"A {type} requires hostPipeId or hostNodeId.");
        return new DeviceHost(pipeId, nodeId);
    }

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        // DeviceType is intentionally excluded: two devices of different types
        // on the same pipe/node share the same host attachment identity.
        yield return HostPipeId;
        yield return HostNodeId;
    }
}
