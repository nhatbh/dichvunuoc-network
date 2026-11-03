namespace WaterNetwork.Asset.Application.Dtos;

public sealed record AssetLifecycleEntryDto(string FromStatus, string ToStatus, string ActorId, string? Reason, DateTime OccurredAt);
