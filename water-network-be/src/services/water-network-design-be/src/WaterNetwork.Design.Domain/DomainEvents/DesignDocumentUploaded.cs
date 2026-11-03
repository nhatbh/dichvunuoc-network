using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterNetwork.Design.Domain.DomainEvents;

public sealed record DesignDocumentUploadedData(
    string ProjectId,
    string TenantId,
    string FileName,
    string ContentType,
    long SizeBytes,
    string FileRef,
    string DocumentType);

public sealed record DesignDocumentUploaded(string AggregateId, DesignDocumentUploadedData Data)
    : DomainEventBase<DesignDocumentUploadedData>(
        aggregateId: AggregateId,
        aggregateType: "DesignDocument",
        eventType: "DesignDocumentUploaded",
        data: Data);
