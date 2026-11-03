namespace WaterNetwork.Design.Domain.ValueObjects;

/// <summary>Existing targets retain their GIS identity. Before is supplied by the server.</summary>
public sealed record NetworkEditOperation(
    string Id, string Action, string Kind, string? TargetId, int? ExpectedVersion,
    DraftAssetSnapshot? After, DraftAssetSnapshot? Before);
