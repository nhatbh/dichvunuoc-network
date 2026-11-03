namespace WaterNetwork.Incident.Contracts.Events;

/// <summary>Minimal asset reference (id + kind) shared by INC-3 event payloads.</summary>
public sealed record IncidentAssetRefV1(string AssetId, string Kind);
