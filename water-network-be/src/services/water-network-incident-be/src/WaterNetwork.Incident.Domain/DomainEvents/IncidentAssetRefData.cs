namespace WaterNetwork.Incident.Domain.DomainEvents;

/// <summary>Minimal asset reference carried by INC-3 domain events (id + kind only).</summary>
public sealed record IncidentAssetRefData(string AssetId, string Kind);
