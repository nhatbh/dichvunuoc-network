using System.Collections.ObjectModel;
using WaterPlatform.BuildingBlocks.Components;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Domain.ValueObjects;

/// <summary>
/// Catalog-declared properties of an asset (DN, second DN, material, angle, valve state, year,
/// condition, elevation, DMA …), validated against the asset's component. Unknown keys are
/// rejected rather than silently stored.
/// </summary>
public sealed class AssetProperties
{
    public static readonly AssetProperties Empty = new(new Dictionary<string, string>(StringComparer.Ordinal));

    public IReadOnlyDictionary<string, string> Values { get; }

    private AssetProperties(IDictionary<string, string> values)
        => Values = new ReadOnlyDictionary<string, string>(new SortedDictionary<string, string>(values, StringComparer.Ordinal));

    public static AssetProperties For(ComponentCode component, IReadOnlyDictionary<string, string>? values)
    {
        if (values is null || values.Count == 0) return Empty;
        var problems = ComponentCatalog.Default.ValidateProperties(component.Value, values);
        if (problems.Count > 0)
            throw new DomainException("AssetProperties.Invalid", string.Join(" ", problems));
        return new AssetProperties(values.ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal));
    }

    /// <summary>Stored values, re-read without validation (they were validated when written).</summary>
    public static AssetProperties Reconstitute(IReadOnlyDictionary<string, string>? values)
        => values is null || values.Count == 0 ? Empty : new AssetProperties(values.ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal));

    /// <summary>
    /// Properties from a draft's attribute bag: keys the component declares are validated, keys no
    /// catalog component declares (provenance, pipe columns, the code itself) are ignored, and a
    /// property of another component (e.g. a setpoint on a gate valve) is rejected.
    /// </summary>
    public static AssetProperties FromAttributes(ComponentCode component, IReadOnlyDictionary<string, string>? attributes)
    {
        var problems = ComponentCatalog.Default.ValidateAttributes(component.Value, attributes);
        if (problems.Count > 0)
            throw new DomainException("AssetProperties.Invalid", string.Join(" ", problems));
        return For(component, ComponentCatalog.Default.PropertiesIn(component.Value, attributes));
    }

    /// <summary>Only the keys the component declares (drops design-side provenance and other attributes).</summary>
    public static IReadOnlyDictionary<string, string> Declared(ComponentCode component, IReadOnlyDictionary<string, string>? attributes)
        => ComponentCatalog.Default.PropertiesIn(component.Value, attributes);
}
