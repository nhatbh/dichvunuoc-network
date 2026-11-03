using System.Text.Json;
using WaterNetwork.Asset.Contracts;
using WaterNetwork.Asset.Contracts.Events;
using WaterNetwork.Gis.Application.Ports;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Gis.Infrastructure.Consumers;

/// <summary>
/// Projects asset lifecycle status into the local network_asset_states read model — the first
/// consumer of water-network-gis-be. Subscribes to asset.registered (seeds the initial status,
/// since registration never emits status.changed) and asset.status.changed (every transition).
/// Tenant is derived from the local GIS asset row: outbox-published envelopes carry no tenant and
/// asset.status.changed has none in its payload (see spec decision #6).
/// </summary>
public sealed class AssetLifecycleProjectionConsumer(
    IAssetStateProjectionStore projection,
    IAssetTenantLookupDao tenantLookup,
    IInboxMessageStore inboxMessageStore)
    : IdempotentEnvelopeConsumer(inboxMessageStore)
{
    protected override string ConsumerName => "gis.asset-lifecycle-projection";

    protected override bool Subscribes(string eventType)
        => eventType is AssetEventTypes.AssetRegistered or AssetEventTypes.StatusChanged;

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var data = doc.RootElement.GetProperty("Data");

        var (assetId, assetKind, status) = envelope.EventType == AssetEventTypes.AssetRegistered
            ? Read(data.Deserialize<AssetRegisteredV1>(), d => (d.AssetId, d.AssetType, d.Status))
            : Read(data.Deserialize<AssetStatusChangedV1>(), d => (d.AssetId, d.AssetType, d.NewStatus));

        var tenantId = await tenantLookup.GetTenantAsync(assetId, assetKind, ct)
            ?? throw new InvalidOperationException(
                $"No GIS asset row for {assetKind} {assetId}; cannot resolve tenant for projection.");

        var occurredAtUtc = envelope.OccurredAt.Kind == DateTimeKind.Utc
            ? envelope.OccurredAt
            : DateTime.SpecifyKind(envelope.OccurredAt, DateTimeKind.Utc);

        await projection.UpsertAsync(assetId, tenantId, status, occurredAtUtc, envelope.EventId, ct);
    }

    private static (string, string, string) Read<T>(T? data, Func<T, (string, string, string)> select)
        => data is null
            ? throw new InvalidOperationException($"Envelope payload Data did not deserialize to {typeof(T).Name}.")
            : select(data);
}
