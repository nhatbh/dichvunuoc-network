using System.Text.Json;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Design.Infrastructure.Consumers;

/// <summary>Reacts to design.revision.approved (the service's own event) and emits the ready-for-gis
/// batch. First consumer of water-network-design-be. Status stays Approved until GIS reports completion.</summary>
public sealed class RevisionApprovedPublishConsumer(
    IDesignRevisionRepository revisionRepository,
    IDraftNetworkAssetRepository draftRepository,
    IInboxMessageStore inboxMessageStore)
    : IdempotentEnvelopeConsumer(inboxMessageStore)
{
    protected override string ConsumerName => "design.revision-approved-publish";

    protected override bool Subscribes(string eventType) => eventType == DesignEventTypes.RevisionApproved;

    protected override async Task HandleAsync(IntegrationEventEnvelope envelope, CancellationToken ct)
    {
        using var doc = JsonDocument.Parse(envelope.Payload);
        var data = doc.RootElement.GetProperty("Data").Deserialize<DesignRevisionApprovedV1>()
            ?? throw new InvalidOperationException("approved payload Data did not deserialize.");

        var revision = await revisionRepository.GetByIdAsync(data.RevisionId, ct);
        if (revision is null || revision.TenantId != data.TenantId || revision.Status != DesignRevisionStatus.Approved)
            return;

        var drafts = await draftRepository.ListByRevisionAsync(data.TenantId, data.RevisionId, ct);
        var snapshots = drafts.Select(ToSnapshot).ToList();

        revision.BeginPublish(snapshots, approvedBy: data.ActorId);
        await revisionRepository.SaveAsync(revision, ct);
    }

    private static DraftAssetSnapshot ToSnapshot(Domain.Entities.DraftNetworkAsset d)
        => new(
            d.Id, d.Kind.ToString(), d.AssetCode, d.ClientRef,
            new DraftGeometrySnapshot(
                d.Geometry.Type.ToString(),
                d.Geometry.Coordinates.Select(c => (IReadOnlyList<double>)new[] { c.Longitude, c.Latitude }).ToList()),
            d.Attributes, d.FromRef, d.ToRef, d.HostRef);
}
