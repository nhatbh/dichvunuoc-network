using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Services;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Application.Commands;

public sealed class ValidateRevisionCommandHandler(
    IDesignRevisionRepository revisions,
    IDraftNetworkAssetRepository drafts,
    IDraftValidationService validationService,
    IGisLookupPort gisLookup,
    ITenantContextAccessor tenantAccessor) : ICommandHandler<ValidateRevisionCommand, ValidationResultDto>
{
    public async Task<ValidationResultDto> HandleAsync(ValidateRevisionCommand command, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");

        var revision = await revisions.GetByIdAsync(command.RevisionId, ct);
        if (revision is null || revision.TenantId != tenant.TenantId)
            throw NotFoundException.Entity("DesignRevision", command.RevisionId);

        revision.EnsureDraftsEditable();
        var revisionDrafts = await drafts.ListByRevisionAsync(tenant.TenantId, revision.Id, ct);
        ValidationResult result;
        if (revision.NetworkEdits is { } edits)
        {
            var inspection = await gisLookup.InspectEdits(tenant.TenantId, edits.Select(NetworkEditMapping.ToContract).ToArray(), ct);
            result = new ValidationResult(inspection.Errors.Select(x => new ValidationIssue(x.Code, x.OperationId, null, x.Field, x.Message)).ToArray(), []);
        }
        else result = await validationService.ValidateAsync(tenant.TenantId, revisionDrafts, gisLookup, ct);

        revision.ApplyValidation(result);
        await revisions.SaveAsync(revision, ct);

        return ToDto(result);
    }

    private static ValidationResultDto ToDto(ValidationResult result) => new(
        IsValid: !result.HasErrors,
        Errors: result.Errors.Select(ToIssueDto).ToList(),
        Warnings: result.Warnings.Select(ToIssueDto).ToList());

    private static ValidationIssueDto ToIssueDto(ValidationIssue i)
        => new(i.Code, i.DraftAssetId, i.ClientRef, i.Field, i.Message);
}
