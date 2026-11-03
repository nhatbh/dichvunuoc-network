using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

/// <summary>Commits document metadata AFTER the file has been stored (fileRef already obtained).</summary>
public sealed record UploadDesignDocumentCommand(
    string ProjectId,
    string FileName,
    string ContentType,
    long SizeBytes,
    string FileRef,
    string DocumentType) : ICommand<string>;
