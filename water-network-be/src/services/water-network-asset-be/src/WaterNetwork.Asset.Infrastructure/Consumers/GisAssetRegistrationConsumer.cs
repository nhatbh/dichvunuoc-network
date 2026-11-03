using System.Text.Json;
using Microsoft.Extensions.Logging;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterNetwork.Gis.Contracts.Events;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Asset.Infrastructure.Consumers;

/// <summary>
/// Consumes GIS registration events and materialises an asset profile for each.
/// First consumer in the platform — see decision 0011.
/// </summary>
public sealed partial class GisAssetRegistrationConsumer(
    INetworkAssetRepository repository,
    IInboxMessageStore inbox,
    ILogger<GisAssetRegistrationConsumer> logger)
    : IdempotentEnvelopeConsumer(inbox)
{
    protected override string ConsumerName => "asset.gis-registration";

    protected override bool Subscribes(string eventType)
        => AssetTypeMapping.FromGisEventType(eventType) is not null;

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Asset {AssetId} already created by a concurrent consumer; continuing.")]
    private static partial void LogAssetAlreadyCreated(ILogger logger, string assetId, Exception ex);

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        // non-null: the base only calls HandleAsync after Subscribes() gated this event type.
        var assetType = AssetTypeMapping.FromGisEventType(envelope.EventType)!.Value;
        var (assetId, tenantId, assetCode) = ExtractIdentity(envelope, assetType);

        // PK == GIS id → natural idempotency. Pre-check avoids a guaranteed unique-violation on redelivery.
        if (!await repository.ExistsAsync(assetId, ct))
        {
            try
            {
                await repository.SaveAsync(
                    NetworkAsset.RegisterFromGis(assetId, tenantId, assetType, assetCode), ct);
            }
            catch (Exception ex) when (IsUniqueViolation(ex))
            {
                // A unique violation is only an idempotent no-op when THIS asset (same id) already exists
                // (a concurrent redelivery won the insert race). If the row for this assetId still does not
                // exist, the violation was a *different* asset colliding on (tenant_id, asset_code) — that is
                // a real conflict that must surface (retry/dead-letter), not be silently dropped.
                if (!await repository.ExistsAsync(assetId, ct))
                    throw;

                LogAssetAlreadyCreated(logger, assetId, ex);
            }
        }
    }

    private static (string assetId, string tenantId, string assetCode) ExtractIdentity(
        IntegrationEventEnvelope envelope, AssetType assetType)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var data = doc.RootElement.GetProperty("Data");
        return assetType switch
        {
            AssetType.Node => Read<NetworkNodeRegisteredV1>(data, d => (d.NodeId, d.TenantId, d.AssetCode)),
            AssetType.Pipe => Read<NetworkPipeRegisteredV1>(data, d => (d.PipeId, d.TenantId, d.AssetCode)),
            AssetType.Device => Read<NetworkDeviceInstalledV1>(data, d => (d.DeviceId, d.TenantId, d.AssetCode)),
            _ => throw new InvalidOperationException($"Unhandled asset type {assetType}")
        };
    }

    private static (string, string, string) Read<T>(JsonElement data, Func<T, (string, string, string)> select)
        => select(data.Deserialize<T>()
                  ?? throw new InvalidOperationException($"Envelope payload Data did not deserialize to {typeof(T).Name}."));

    // Local PG 23505 detection. Mirror of Gis PostgresExceptionHelper; promote to a building block
    // when a 2nd service needs it (backlog follow-up).
    private static bool IsUniqueViolation(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException)
            if (e is Npgsql.PostgresException { SqlState: "23505" })
                return true;
        return false;
    }
}
