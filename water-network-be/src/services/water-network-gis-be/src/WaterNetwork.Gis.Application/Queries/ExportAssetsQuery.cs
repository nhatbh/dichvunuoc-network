using WaterNetwork.Gis.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Queries;

namespace WaterNetwork.Gis.Application.Queries;

/// <summary>Keyset export of all live assets for the caller's tenant, for
/// topology-rs full graph rebuild. Cursor is the last returned id.</summary>
public sealed record ExportAssetsQuery(string? Cursor, int Limit) : IQuery<AssetExportPageDto>;
