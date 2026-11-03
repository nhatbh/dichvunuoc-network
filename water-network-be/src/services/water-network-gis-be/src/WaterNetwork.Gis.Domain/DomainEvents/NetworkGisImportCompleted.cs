using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Gis.Domain.DomainEvents;

public sealed record GisImportedAsset(string DraftAssetId, string GisAssetId, string Kind, string AssetCode);
public sealed record GisImportFailure(string DraftAssetId, string AssetCode, string Reason);

public sealed record NetworkGisImportCompletedData(
    string RevisionId,
    string TenantId,
    IReadOnlyList<GisImportedAsset> Imported,
    IReadOnlyList<GisImportFailure> Failed);

public sealed record NetworkGisImportCompleted(string AggregateId, NetworkGisImportCompletedData Data)
    : DomainEventBase<NetworkGisImportCompletedData>(
        aggregateId: AggregateId,
        aggregateType: "GisImportBatch",
        eventType: "NetworkGisImportCompleted",
        data: Data);
