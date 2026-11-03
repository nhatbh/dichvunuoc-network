namespace WaterNetwork.Design.Application.Dtos;

public sealed record ImportResultDto(string DraftAssetId, string? GisAssetId, string Status, string? Reason);
