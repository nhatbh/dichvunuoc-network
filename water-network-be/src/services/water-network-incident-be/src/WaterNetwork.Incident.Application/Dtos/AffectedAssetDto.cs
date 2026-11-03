namespace WaterNetwork.Incident.Application.Dtos;

public sealed record AffectedAssetDto(string AssetId, string Kind, bool Verified);
