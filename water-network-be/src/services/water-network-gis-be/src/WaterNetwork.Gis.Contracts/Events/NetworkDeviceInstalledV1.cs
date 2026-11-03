namespace WaterNetwork.Gis.Contracts.Events;

/// <summary>
/// v1 payload for the <c>network.device.installed</c> integration event.
/// Unlike pipe geometry, the device location (a single point) IS included —
/// it is cheap and most consumers (asset, observation, topology) want it.
/// Exactly one of <c>HostPipeId</c>/<c>HostNodeId</c> is non-null, enforced
/// upstream by the DeviceHost domain rule per device type.
/// </summary>
public sealed record NetworkDeviceInstalledV1(
    string DeviceId,
    string TenantId,
    string AssetCode,
    string DeviceType,
    string? HostPipeId,
    string? HostNodeId,
    double Latitude,
    double Longitude);
