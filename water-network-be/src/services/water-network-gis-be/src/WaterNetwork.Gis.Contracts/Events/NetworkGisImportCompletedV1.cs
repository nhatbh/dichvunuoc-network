namespace WaterNetwork.Gis.Contracts.Events;

/// <summary>v1 payload for <c>network.gis-import.completed</c>.</summary>
public sealed record NetworkGisImportCompletedV1(
    string RevisionId,
    string TenantId,
    IReadOnlyList<GisImportedAssetV1> Imported,
    IReadOnlyList<GisImportFailureV1> Failed);

public sealed record GisImportedAssetV1(
    string DraftAssetId,
    string GisAssetId,
    string Kind,
    string AssetCode);

public sealed record GisImportFailureV1(
    string DraftAssetId,
    string AssetCode,
    string Reason);
