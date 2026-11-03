namespace WaterNetwork.Design.Contracts.Events;

/// <summary>v1 payload for <c>design.document.uploaded</c>.</summary>
public sealed record DesignDocumentUploadedV1(
    string DocumentId,
    string ProjectId,
    string TenantId,
    string FileName,
    string ContentType,
    long SizeBytes,
    string FileRef,
    string DocumentType);
