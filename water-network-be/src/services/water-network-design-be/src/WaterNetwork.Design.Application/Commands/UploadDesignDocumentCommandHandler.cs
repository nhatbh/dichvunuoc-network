using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class UploadDesignDocumentCommandHandler(
    IDesignDocumentRepository repository,
    ITenantContextAccessor tenantAccessor,
    IRequestContextProvider requestContextProvider) : ICommandHandler<UploadDesignDocumentCommand, string>
{
    public async Task<string> HandleAsync(UploadDesignDocumentCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required to upload a document.");
        var actor = requestContextProvider.Current()?.UserId ?? tenant.TenantId;

        var document = DesignDocument.Create(
            command.ProjectId, tenant.TenantId, command.FileName, command.ContentType,
            command.SizeBytes, command.FileRef, command.DocumentType, actor);

        await repository.SaveAsync(document, ct);
        return document.Id;
    }
}
