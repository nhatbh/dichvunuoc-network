using WaterNetwork.Design.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Entities;

namespace WaterNetwork.Design.Domain.Aggregates;

public sealed class DesignDocument : AggregateRoot
{
    public string ProjectId { get; private set; }
    public string TenantId { get; private set; }
    public string FileName { get; private set; }
    public string ContentType { get; private set; }
    public long SizeBytes { get; private set; }
    public string FileRef { get; private set; }
    public string DocumentType { get; private set; }
    public string UploadedBy { get; private set; }

    private DesignDocument(
        string id, string projectId, string tenantId, string fileName, string contentType,
        long sizeBytes, string fileRef, string documentType, string uploadedBy,
        int version = 0, DateTime? createdAt = null, DateTime? updatedAt = null)
        : base(id, version, createdAt, updatedAt)
    {
        ProjectId = projectId;
        TenantId = tenantId;
        FileName = fileName;
        ContentType = contentType;
        SizeBytes = sizeBytes;
        FileRef = fileRef;
        DocumentType = documentType;
        UploadedBy = uploadedBy;
    }

    public static DesignDocument Create(
        string projectId, string tenantId, string fileName, string contentType,
        long sizeBytes, string fileRef, string documentType, string uploadedBy)
    {
        var doc = new DesignDocument(
            Guid.CreateVersion7().ToString(), projectId, tenantId, fileName, contentType,
            sizeBytes, fileRef, documentType, uploadedBy);
        doc.MarkAsModified();
        doc.AddDomainEvent(new DesignDocumentUploaded(doc.Id, new DesignDocumentUploadedData(
            projectId, tenantId, fileName, contentType, sizeBytes, fileRef, documentType)));
        return doc;
    }

    public static DesignDocument Reconstitute(
        string id, string projectId, string tenantId, string fileName, string contentType,
        long sizeBytes, string fileRef, string documentType, string uploadedBy,
        int version, DateTime createdAt, DateTime updatedAt)
        => new(id, projectId, tenantId, fileName, contentType, sizeBytes, fileRef, documentType, uploadedBy,
            version, createdAt, updatedAt);
}
