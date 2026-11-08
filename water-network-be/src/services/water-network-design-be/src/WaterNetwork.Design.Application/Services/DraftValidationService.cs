// DraftValidationService.cs
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Components;

namespace WaterNetwork.Design.Application.Services;

public sealed class DraftValidationService : IDraftValidationService
{
    private static IComponentCatalog Catalog => ComponentCatalog.Default;

    public async Task<ValidationResult> ValidateAsync(
        string tenantId, IReadOnlyList<DraftNetworkAsset> drafts, IGisLookupPort gisLookup, CancellationToken ct)
    {
        var errors = new List<ValidationIssue>();
        var warnings = new List<ValidationIssue>();

        // One lookup per distinct asset code, with bounded network concurrency. Do not
        // create one Task per draft or serialize thousands of HTTP round trips. Results
        // are collected by index and issues are still emitted in original draft order.
        var codes = drafts.Select(d => d.AssetCode).Distinct(StringComparer.Ordinal).ToArray();
        var exists = new bool[codes.Length];
        await Parallel.ForEachAsync(Enumerable.Range(0, codes.Length),
            new ParallelOptions { MaxDegreeOfParallelism = 16, CancellationToken = ct },
            async (index, token) => exists[index] = await gisLookup.AssetCodeExists(tenantId, codes[index], token));
        var existingCodes = codes.Where((_, index) => exists[index]).ToHashSet(StringComparer.Ordinal);

        // Index drafts by both clientRef and id so cross-references resolve either way.
        var byRef = new Dictionary<string, DraftNetworkAsset>(StringComparer.Ordinal);
        foreach (var d in drafts)
        {
            byRef[d.Id] = d;
            if (!string.IsNullOrWhiteSpace(d.ClientRef)) byRef[d.ClientRef] = d;
        }

        // Rule: duplicate asset code within the revision.
        foreach (var group in drafts.GroupBy(d => d.AssetCode, StringComparer.Ordinal).Where(g => g.Count() > 1))
            foreach (var d in group)
                errors.Add(new ValidationIssue("DuplicateAssetCode", d.Id, d.ClientRef, "assetCode",
                    $"Asset code '{group.Key}' is used by more than one draft in this revision."));

        foreach (var d in drafts)
        {
            ct.ThrowIfCancellationRequested();
            // Rule: asset code already exists in GIS. Draft endpoint/host references
            // resolve only through byRef below, without extra downstream requests.
            if (existingCodes.Contains(d.AssetCode))
                errors.Add(new ValidationIssue("AssetCodeExistsInGis", d.Id, d.ClientRef, "assetCode",
                    $"Asset code '{d.AssetCode}' already exists in GIS."));

            // Rule: geometry must be valid per NTS (catches self-intersection / zero-length).
            var nts = NtsGeometryConverter.ToNts(d.Geometry);
            if (!nts.IsValid)
                errors.Add(new ValidationIssue("InvalidGeometry", d.Id, d.ClientRef, "geometry",
                    "Geometry is not OGC-valid."));

            // Rule: every asset is a catalog component of its kind (decision 0028); pipes default to "Pipe".
            var component = ValidateComponent(d, errors);

            switch (d.Kind)
            {
                case DraftAssetKind.Pipe:
                    ValidatePipe(d, byRef, errors);
                    break;

                case DraftAssetKind.Device when component is not null:
                    ValidateDeviceHost(d, component, byRef, errors);
                    break;
            }
        }

        return new ValidationResult(errors, warnings);
    }

    private static void ValidatePipe(
        DraftNetworkAsset pipe, Dictionary<string, DraftNetworkAsset> byRef, List<ValidationIssue> errors)
    {
        EndpointMustBeNode(pipe, pipe.FromRef, "fromRef", byRef, errors);
        EndpointMustBeNode(pipe, pipe.ToRef, "toRef", byRef, errors);

        if (!HasPositiveInt(pipe.Attributes, "diameterMm"))
            errors.Add(new ValidationIssue("MissingRequiredAttribute", pipe.Id, pipe.ClientRef, "diameterMm",
                "Pipe requires attribute 'diameterMm' as a positive integer."));
        RequireAttr(pipe, "material", errors);
    }

    private static void EndpointMustBeNode(
        DraftNetworkAsset pipe, string? endpointRef, string field,
        Dictionary<string, DraftNetworkAsset> byRef, List<ValidationIssue> errors)
    {
        if (string.IsNullOrWhiteSpace(endpointRef) ||
            !byRef.TryGetValue(endpointRef, out var target) || target.Kind != DraftAssetKind.Node)
        {
            errors.Add(new ValidationIssue("PipeEndpointMissing", pipe.Id, pipe.ClientRef, field,
                $"Pipe {field} '{endpointRef}' does not resolve to a draft node in this revision."));
        }
    }

    private static ComponentDefinition? ValidateComponent(DraftNetworkAsset d, List<ValidationIssue> errors)
    {
        var raw = d.Attributes.GetValueOrDefault("componentCode");
        if (string.IsNullOrWhiteSpace(raw))
        {
            if (d.Kind == DraftAssetKind.Pipe) raw = "Pipe";
            else
            {
                errors.Add(new ValidationIssue("MissingRequiredAttribute", d.Id, d.ClientRef, "componentCode",
                    $"{d.Kind} requires attribute 'componentCode' (a catalog component)."));
                return null;
            }
        }

        var component = Catalog.Find(raw);
        if (component is null)
        {
            errors.Add(new ValidationIssue("UnknownComponent", d.Id, d.ClientRef, "componentCode",
                $"'{raw}' is not a component code in the platform catalog."));
            return null;
        }
        if (component.Kind.ToString() != d.Kind.ToString())
        {
            errors.Add(new ValidationIssue("ComponentKindMismatch", d.Id, d.ClientRef, "componentCode",
                $"'{component.Code}' is a {component.Kind}, not a {d.Kind}."));
            return null;
        }

        foreach (var problem in Catalog.ValidateAttributes(component.Code, d.Attributes))
            errors.Add(new ValidationIssue("InvalidProperty", d.Id, d.ClientRef, "attributes", problem));
        return component;
    }

    private static void ValidateDeviceHost(
        DraftNetworkAsset device, ComponentDefinition component,
        Dictionary<string, DraftNetworkAsset> byRef, List<ValidationIssue> errors)
    {
        var host = device.HostRef is not null && byRef.TryGetValue(device.HostRef, out var h) ? h : null;
        var expected = component.Host == ComponentHosts.Pipe ? DraftAssetKind.Pipe : DraftAssetKind.Node;
        if (host?.Kind != expected)
            errors.Add(new ValidationIssue("InvalidDeviceHost", device.Id, device.ClientRef, "hostRef",
                $"A {component.Code} attaches to a {expected.ToString().ToLowerInvariant()}; its host reference is invalid or missing."));
    }

    private static void RequireAttr(DraftNetworkAsset d, string key, List<ValidationIssue> errors)
    {
        if (!d.Attributes.TryGetValue(key, out var v) || string.IsNullOrWhiteSpace(v))
            errors.Add(new ValidationIssue("MissingRequiredAttribute", d.Id, d.ClientRef, key,
                $"Required attribute '{key}' is missing."));
    }

    private static bool HasPositiveInt(IReadOnlyDictionary<string, string> attrs, string key)
        => attrs.TryGetValue(key, out var raw) && int.TryParse(raw, out var n) && n > 0;
}
