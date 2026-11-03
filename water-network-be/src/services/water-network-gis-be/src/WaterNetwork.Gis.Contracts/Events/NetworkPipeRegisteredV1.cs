namespace WaterNetwork.Gis.Contracts.Events;

/// <summary>
/// v1 payload for the <c>network.pipe.registered</c> integration event.
///
/// <para>
/// <strong>Geometry is intentionally absent.</strong> Consumers that need the pipe's spatial
/// geometry must query the read-model snapshot. Keeping geometry out of the event avoids
/// message-size growth for the majority of subscribers (billing, alerting, search-index)
/// that only need topology metadata.
/// </para>
///
/// <para>
/// <strong>DiameterMm is <c>int</c>.</strong> The domain VO uses <c>double</c> internally,
/// but physical diameter catalog values are always whole-millimetre integers (e.g. 150, 200).
/// The contract surface uses <c>int</c> to match the persistence column type and to avoid
/// floating-point noise for downstream consumers. The mapper applies
/// <c>Convert.ToInt32</c> when translating from domain to integration event.
/// </para>
/// </summary>
public sealed record NetworkPipeRegisteredV1(
    string PipeId,
    string TenantId,
    string AssetCode,
    string FromNodeId,
    string ToNodeId,
    double LengthM,
    int DiameterMm,
    string Material);
