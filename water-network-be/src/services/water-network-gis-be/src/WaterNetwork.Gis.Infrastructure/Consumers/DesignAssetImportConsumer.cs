using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Application.Common;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Gis.Infrastructure.Consumers;

/// <summary>
/// Consumes <c>design.asset.ready-for-gis</c> envelopes and imports each draft asset into
/// the GIS write model in order Node → Pipe → Device.
/// Per-asset failures (mapping error, conflict, business rule, PG unique violation) are
/// captured in <c>failed[]</c> without aborting the batch; infrastructure errors propagate
/// so the inbox scheduler will retry the whole envelope.
/// Idempotency is double-guarded: the inbox deduplicates by EventId, and the
/// <see cref="IGisImportLedgerStore"/> deduplicates by (revisionId, draftAssetId).
/// </summary>
public sealed class DesignAssetImportConsumer(
    INetworkNodeRepository nodeRepository,
    INetworkPipeRepository pipeRepository,
    INetworkDeviceRepository deviceRepository,
    IGeometryVersionStore geometryVersionStore,
    IPipeLengthCalculator pipeLengthCalculator,
    IGisImportLedgerStore ledger,
    IGisImportBatchRepository batchRepository,
    IInboxMessageStore inboxMessageStore,
    GisDbContext dbContext)
    : IdempotentEnvelopeConsumer(inboxMessageStore)
{
    protected override string ConsumerName => "gis.design-asset-import";

    protected override bool Subscribes(string eventType)
        => eventType == DesignEventTypes.AssetReadyForGis;

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var batch = doc.RootElement.GetProperty("Data").Deserialize<DesignAssetReadyForGisV1>()
            ?? throw new InvalidOperationException("Envelope payload Data did not deserialize to DesignAssetReadyForGisV1.");

        var tenantId = batch.TenantId;
        var revisionId = batch.RevisionId;

        var imported = new List<GisImportedAsset>();
        var failed = new List<GisImportFailure>();

        // (clientRef) → (GisId, Kind) — populated as we go so Pipe/Device can resolve endpoints/hosts.
        var refMap = new Dictionary<string, (string GisId, string Kind)>(StringComparer.Ordinal);

        // Process in required order: Node → Pipe → Device
        var ordered = batch.Assets
            .Where(a => a.Kind == "Node")
            .Concat(batch.Assets.Where(a => a.Kind == "Pipe"))
            .Concat(batch.Assets.Where(a => a.Kind == "Device"));

        foreach (var asset in ordered)
        {
            try
            {
                // ── ledger dedup (idempotent re-delivery within same revision) ──────────────
                var existingGisId = await ledger.GetExistingAsync(revisionId, asset.DraftAssetId, ct);
                if (existingGisId is not null)
                {
                    imported.Add(new GisImportedAsset(asset.DraftAssetId, existingGisId, asset.Kind, asset.AssetCode));
                    if (asset.ClientRef is not null)
                        refMap[asset.ClientRef] = (existingGisId, asset.Kind);
                    continue;
                }

                var gisId = await CreateAssetAsync(asset, tenantId, refMap, ct);

                await ledger.RecordAsync(tenantId, revisionId, asset.DraftAssetId, gisId, asset.Kind, asset.AssetCode, ct);
                imported.Add(new GisImportedAsset(asset.DraftAssetId, gisId, asset.Kind, asset.AssetCode));
                if (asset.ClientRef is not null)
                    refMap[asset.ClientRef] = (gisId, asset.Kind);
            }
            catch (Exception ex) when (
                ex is DraftMappingException
                or ConflictException
                or BusinessRuleException
                or DomainException
                || PostgresExceptionHelper.IsUniqueViolation(ex))
            {
                failed.Add(new GisImportFailure(asset.DraftAssetId, asset.AssetCode, ex.Message));
                // Discard any rows staged by the failed asset (e.g. geometry_version staged by
                // AppendAsync before the node SaveAsync rolled back). Mirrors GisImportLedgerStore:31.
                // Safe: prior successful assets are already committed+detached; only the failed
                // asset's unflushable Added entries remain in the tracker.
                dbContext.ChangeTracker.Clear();
            }
            // All other exceptions (e.g. DB connection loss) propagate → inbox retry.
        }

        await batchRepository.SaveAsync(
            GisImportBatch.Completed(revisionId, tenantId, imported, failed), ct);
    }

    private async Task<string> CreateAssetAsync(
        ReadyForGisAssetV1 asset,
        string tenantId,
        Dictionary<string, (string GisId, string Kind)> refMap,
        CancellationToken ct)
    {
        return asset.Kind switch
        {
            "Node" => await CreateNodeAsync(asset, tenantId, ct),
            "Pipe" => await CreatePipeAsync(asset, tenantId, refMap, ct),
            "Device" => await CreateDeviceAsync(asset, tenantId, refMap, ct),
            _ => throw new DraftMappingException($"Draft '{asset.AssetCode}': unknown Kind '{asset.Kind}'.")
        };
    }

    // ── Node ──────────────────────────────────────────────────────────────────────────────────

    private async Task<string> CreateNodeAsync(
        ReadyForGisAssetV1 asset, string tenantId, CancellationToken ct)
    {
        if (await nodeRepository.ExistsByAssetCodeAsync(tenantId, asset.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkNode", "AssetCode", asset.AssetCode);

        var (point, nodeType) = DraftAssetMapper.MapNode(asset);

        var node = NetworkNode.Register(tenantId, new AssetCode(asset.AssetCode), nodeType, point);

        // Append geometry version — mirrors RegisterNodeCommandHandler exactly.
        var version = await geometryVersionStore.GetNextVersionAsync(node.Id, ct);
        var geoJson = GeoJsonPoint(point.Longitude, point.Latitude);
        await geometryVersionStore.AppendAsync(
            GeometryVersion.Create(
                node.Id,
                AssetKind.Parse("Node"),
                version,
                geoJson,
                changedBy: "design-import",
                reason: null),
            ct);

        try
        {
            await nodeRepository.SaveAsync(node, ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("NetworkNode", "AssetCode", asset.AssetCode);
        }

        return node.Id;
    }

    // ── Pipe ──────────────────────────────────────────────────────────────────────────────────

    private async Task<string> CreatePipeAsync(
        ReadyForGisAssetV1 asset,
        string tenantId,
        Dictionary<string, (string GisId, string Kind)> refMap,
        CancellationToken ct)
    {
        if (await pipeRepository.ExistsByAssetCodeAsync(tenantId, asset.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkPipe", "AssetCode", asset.AssetCode);

        var m = DraftAssetMapper.MapPipe(asset, IdOnly(refMap));

        // Build the calculator input: IReadOnlyList<(double Lat, double Lng)>
        var calcPoints = m.Points
            .Select(p => (Lat: p.Latitude, Lng: p.Longitude))
            .ToList();
        var calculatedLength = await pipeLengthCalculator.CalculateMetersAsync(calcPoints, ct);

        var lengthM = m.LengthM ?? calculatedLength;

        var pipe = NetworkPipe.Register(
            tenantId: tenantId,
            assetCode: new AssetCode(asset.AssetCode),
            fromNodeId: m.FromNodeId,
            toNodeId: m.ToNodeId,
            geometry: new PipeGeometry(m.Points),
            diameterMm: new Diameter(m.DiameterMm),
            material: PipeMaterial.Parse(m.Material),
            lengthM: lengthM,
            lengthValidationWarning: null);

        try
        {
            await pipeRepository.SaveAsync(pipe, ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("NetworkPipe", "AssetCode", asset.AssetCode);
        }

        return pipe.Id;
    }

    // ── Device ────────────────────────────────────────────────────────────────────────────────

    private async Task<string> CreateDeviceAsync(
        ReadyForGisAssetV1 asset,
        string tenantId,
        Dictionary<string, (string GisId, string Kind)> refMap,
        CancellationToken ct)
    {
        if (await deviceRepository.ExistsByAssetCodeAsync(tenantId, asset.AssetCode, ct))
            throw ConflictException.Duplicate("NetworkDevice", "AssetCode", asset.AssetCode);

        var m = DraftAssetMapper.MapDevice(asset, IdOnly(refMap));

        // Determine host slot from the kind of the referenced asset (resolved via refMap).
        // MapDevice already throws DraftMappingException for a null or unresolved HostRef,
        // so by this point asset.HostRef is non-null and present in refMap.
        refMap.TryGetValue(asset.HostRef!, out var hostEntry);

        var deviceType = DeviceType.Parse(m.DeviceType);

        var host = hostEntry.Kind == "Pipe"
            ? DeviceHost.For(deviceType, hostPipeId: m.HostPipeOrNodeId, hostNodeId: null)
            : DeviceHost.For(deviceType, hostPipeId: null, hostNodeId: m.HostPipeOrNodeId);

        var device = NetworkDevice.Install(
            tenantId: tenantId,
            assetCode: new AssetCode(asset.AssetCode),
            deviceType: deviceType,
            host: host,
            location: m.Location);

        try
        {
            await deviceRepository.SaveAsync(device, ct);
        }
        catch (DbUpdateException ex) when (PostgresExceptionHelper.IsUniqueViolation(ex))
        {
            throw ConflictException.Duplicate("NetworkDevice", "AssetCode", asset.AssetCode);
        }

        return device.Id;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────

    /// <summary>Projects the refMap to clientRef→GisId for use by DraftAssetMapper.</summary>
    private static Dictionary<string, string> IdOnly(
        IReadOnlyDictionary<string, (string GisId, string Kind)> m)
        => m.ToDictionary(kv => kv.Key, kv => kv.Value.GisId, StringComparer.Ordinal);

    /// <summary>
    /// Inlines GeoJSON Point formatting (mirrors GeoJsonHelper.GeoJsonPoint which is internal
    /// to the Application layer and inaccessible from Infrastructure).
    /// </summary>
    private static string GeoJsonPoint(double lng, double lat)
        => $"{{\"type\":\"Point\",\"coordinates\":[{lng.ToString(CultureInfo.InvariantCulture)},{lat.ToString(CultureInfo.InvariantCulture)}]}}";
}
