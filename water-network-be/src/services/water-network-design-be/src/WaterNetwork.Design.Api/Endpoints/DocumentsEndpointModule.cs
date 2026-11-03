using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Design.Api.Endpoints;

public sealed class DocumentsEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/design/projects/{projectId}/documents");

        group.MapPost("/", async (
                string projectId,
                HttpRequest httpRequest,
                IDesignProjectReadDao projects,
                IFileStoragePort storage,
                IOptions<FileStorageOptions> options,
                ITenantContextAccessor tenantAccessor,
                ICommandBus bus,
                CancellationToken ct) =>
            {
                var tenant = tenantAccessor.Current
                    ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

                if (!httpRequest.HasFormContentType)
                    return Results.Problem("multipart/form-data with a 'file' part is required.", statusCode: 400);

                var form = await httpRequest.ReadFormAsync(ct);
                var file = form.Files.GetFile("file");
                var documentTypeRaw = form["documentType"].ToString();

                if (file is null || file.Length == 0)
                    return Results.Problem("A non-empty 'file' part is required.", statusCode: 400);

                var opts = options.Value;
                if (file.Length > opts.MaxSizeBytes)
                    return Results.Problem($"File exceeds the maximum size of {opts.MaxSizeBytes} bytes.", statusCode: 400);
                if (opts.AllowedContentTypes.Length > 0 &&
                    Array.IndexOf(opts.AllowedContentTypes, file.ContentType) < 0)
                    return Results.Problem($"Content type '{file.ContentType}' is not allowed.", statusCode: 400);
                if (!Enum.TryParse<DesignDocumentType>(documentTypeRaw, ignoreCase: true, out var docType))
                    return Results.Problem("documentType must be one of: Pdf, Dwg, Dxf, GeoJson, Other.", statusCode: 400);

                // Project must exist + belong to caller's tenant (404 also hides cross-tenant ids).
                if (!await projects.ExistsAsync(tenant.TenantId, projectId, ct))
                    return Results.NotFound();

                // Step 1: store the file. Storage failure → 502, metadata NOT committed.
                string fileRef;
                try
                {
                    await using var stream = file.OpenReadStream();
                    fileRef = await storage.SaveAsync(file.FileName, file.ContentType, stream, ct);
                }
                catch (OperationCanceledException)
                {
                    throw; // client aborted — don't mask cancellation as a storage failure
                }
                catch (Exception)
                {
                    return Results.Problem("File storage is unavailable.", statusCode: 502);
                }

                // Step 2: commit metadata + outbox event.
                var id = await bus.ExecuteAsync(new UploadDesignDocumentCommand(
                    projectId, file.FileName, file.ContentType, file.Length, fileRef, docType.ToString()), ct);

                return Results.Created($"/api/design/projects/{projectId}/documents/{id}", new { id });
            })
            .RequirePermission("network-design:write")
            .DisableAntiforgery();
    }
}
