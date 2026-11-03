// IDraftValidationService.cs
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.Application.Services;

public interface IDraftValidationService
{
    Task<ValidationResult> ValidateAsync(
        string tenantId,
        IReadOnlyList<DraftNetworkAsset> drafts,
        IGisLookupPort gisLookup,
        CancellationToken ct);
}
