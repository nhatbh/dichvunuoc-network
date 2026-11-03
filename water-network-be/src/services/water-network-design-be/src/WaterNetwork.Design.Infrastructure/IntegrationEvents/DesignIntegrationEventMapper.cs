using System.Linq;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Design.Infrastructure.IntegrationEvents;

public sealed record DesignProjectCreatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignProjectCreatedV1 Data)
    : IIntegrationEvent<DesignProjectCreatedV1>;

public sealed record DesignDocumentUploadedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignDocumentUploadedV1 Data)
    : IIntegrationEvent<DesignDocumentUploadedV1>;

public sealed record DesignRevisionCreatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionCreatedV1 Data)
    : IIntegrationEvent<DesignRevisionCreatedV1>;

public sealed record DesignRevisionValidatedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionValidatedV1 Data)
    : IIntegrationEvent<DesignRevisionValidatedV1>;

public sealed record DesignRevisionSubmittedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionSubmittedV1 Data)
    : IIntegrationEvent<DesignRevisionSubmittedV1>;

public sealed record DesignRevisionApprovedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionApprovedV1 Data)
    : IIntegrationEvent<DesignRevisionApprovedV1>;

public sealed record DesignRevisionRejectedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionRejectedV1 Data)
    : IIntegrationEvent<DesignRevisionRejectedV1>;

public sealed record DesignAssetReadyForGisIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignAssetReadyForGisV1 Data)
    : IIntegrationEvent<DesignAssetReadyForGisV1>;

public sealed record DesignRevisionPublishedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionPublishedV1 Data)
    : IIntegrationEvent<DesignRevisionPublishedV1>;

public sealed record DesignRevisionDraftsChangedIntegrationEvent(
    string EventId, string EventType, int EventVersion, DateTime OccurredAt,
    string SourceAggregateId, string SourceAggregateType, DesignRevisionDraftsChangedData Data)
    : IIntegrationEvent<DesignRevisionDraftsChangedData>;

public sealed record DesignNetworkEditsReadyIntegrationEvent(string EventId, string EventType, int EventVersion,
    DateTime OccurredAt, string SourceAggregateId, string SourceAggregateType, DesignNetworkEditsReadyV1 Data)
    : IIntegrationEvent<DesignNetworkEditsReadyV1>;

public sealed class DesignIntegrationEventMapper : IIntegrationEventMapper
{
    private static readonly Dictionary<string, Func<IDomainEvent, IIntegrationEvent?>> Registry =
        new(StringComparer.Ordinal)
        {
            ["DesignRevisionDraftsChanged"] = e => e is DesignRevisionDraftsChanged x
                ? new DesignRevisionDraftsChangedIntegrationEvent(x.EventId, "design.revision.drafts-changed", 1, x.OccurredAt, x.AggregateId, x.AggregateType, x.Data) : null,
            ["DesignNetworkEditsReady"] = e => e is DesignNetworkEditsReady x
                ? new DesignNetworkEditsReadyIntegrationEvent(x.EventId, "design.network-edits.ready", 1, x.OccurredAt, x.AggregateId, x.AggregateType,
                    new(x.AggregateId, x.Data.TenantId, x.Data.ApprovedBy, x.Data.Operations.Select(WaterNetwork.Design.Application.Services.NetworkEditMapping.ToContract).ToArray())) : null,
            ["DesignProjectCreated"] = e => e is DesignProjectCreated x ? MapProjectCreated(x) : null,
            ["DesignDocumentUploaded"] = e => e is DesignDocumentUploaded x ? MapDocumentUploaded(x) : null,
            ["DesignRevisionCreated"] = e => e is DesignRevisionCreated x ? MapRevisionCreated(x) : null,
            ["DesignRevisionValidated"] = e => e is DesignRevisionValidated x ? MapRevisionValidated(x) : null,
            ["DesignRevisionSubmitted"] = e => e is DesignRevisionSubmitted x ? MapRevisionSubmitted(x) : null,
            ["DesignRevisionApproved"] = e => e is DesignRevisionApproved x ? MapRevisionApproved(x) : null,
            ["DesignRevisionRejected"] = e => e is DesignRevisionRejected x ? MapRevisionRejected(x) : null,
            ["DesignAssetReadyForGis"] = e => e is DesignAssetReadyForGis x ? MapReadyForGis(x) : null,
            ["DesignRevisionPublished"] = e => e is DesignRevisionPublished x ? MapRevisionPublished(x) : null,
        };

    public bool CanMap(string eventType) => Registry.ContainsKey(eventType);

    public IIntegrationEvent? Map(IDomainEvent domainEvent)
        => Registry.TryGetValue(domainEvent.EventType, out var map) ? map(domainEvent) : null;

    private static DesignProjectCreatedIntegrationEvent MapProjectCreated(DesignProjectCreated e)
        => new(e.EventId, DesignEventTypes.ProjectCreated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignProjectCreatedV1(e.AggregateId, e.Data.TenantId, e.Data.Name, e.Data.BranchId, e.Data.ZoneId));

    private static DesignDocumentUploadedIntegrationEvent MapDocumentUploaded(DesignDocumentUploaded e)
        => new(e.EventId, DesignEventTypes.DocumentUploaded, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignDocumentUploadedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId, e.Data.FileName,
                e.Data.ContentType, e.Data.SizeBytes, e.Data.FileRef, e.Data.DocumentType));

    private static DesignRevisionCreatedIntegrationEvent MapRevisionCreated(DesignRevisionCreated e)
        => new(e.EventId, DesignEventTypes.RevisionCreated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionCreatedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId, e.Data.RevisionNumber));

    private static DesignRevisionValidatedIntegrationEvent MapRevisionValidated(DesignRevisionValidated e)
        => new(e.EventId, DesignEventTypes.RevisionValidated, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionValidatedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId,
                e.Data.ErrorCount, e.Data.WarningCount, e.Data.IsValid));

    private static DesignRevisionSubmittedIntegrationEvent MapRevisionSubmitted(DesignRevisionSubmitted e)
        => new(e.EventId, DesignEventTypes.RevisionSubmitted, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionSubmittedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId,
                e.Data.RevisionNumber, e.Data.ActorId));

    private static DesignRevisionApprovedIntegrationEvent MapRevisionApproved(DesignRevisionApproved e)
        => new(e.EventId, DesignEventTypes.RevisionApproved, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionApprovedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId,
                e.Data.RevisionNumber, e.Data.ActorId, e.Data.Reason));

    private static DesignRevisionRejectedIntegrationEvent MapRevisionRejected(DesignRevisionRejected e)
        => new(e.EventId, DesignEventTypes.RevisionRejected, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionRejectedV1(e.AggregateId, e.Data.ProjectId, e.Data.TenantId,
                e.Data.RevisionNumber, e.Data.ActorId, e.Data.Reason));

    private static DesignAssetReadyForGisIntegrationEvent MapReadyForGis(DesignAssetReadyForGis e)
        => new(e.EventId, DesignEventTypes.AssetReadyForGis, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignAssetReadyForGisV1(
                RevisionId: e.AggregateId,
                ProjectId: e.Data.ProjectId,
                TenantId: e.Data.TenantId,
                RevisionNumber: e.Data.RevisionNumber,
                ApprovedBy: e.Data.ApprovedBy,
                Assets: e.Data.Assets.Select(a => new ReadyForGisAssetV1(
                    a.DraftAssetId, a.Kind, a.AssetCode, a.ClientRef,
                    new ReadyForGisGeometryV1(a.Geometry.Type, a.Geometry.Coordinates),
                    a.Attributes, a.FromRef, a.ToRef, a.HostRef)).ToList()));

    private static DesignRevisionPublishedIntegrationEvent MapRevisionPublished(DesignRevisionPublished e)
        => new(e.EventId, DesignEventTypes.RevisionPublished, 1, e.OccurredAt, e.AggregateId, e.AggregateType,
            new DesignRevisionPublishedV1(
                RevisionId: e.AggregateId,
                ProjectId: e.Data.ProjectId,
                TenantId: e.Data.TenantId,
                RevisionNumber: e.Data.RevisionNumber,
                ActorId: e.Data.ActorId,
                Status: e.Data.Status,
                ImportedCount: e.Data.ImportedCount,
                FailedCount: e.Data.FailedCount));
}
