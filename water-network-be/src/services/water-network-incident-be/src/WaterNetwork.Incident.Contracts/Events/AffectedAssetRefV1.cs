namespace WaterNetwork.Incident.Contracts.Events;

public sealed record AffectedAssetRefV1(string AssetId, string Kind, bool Verified);
