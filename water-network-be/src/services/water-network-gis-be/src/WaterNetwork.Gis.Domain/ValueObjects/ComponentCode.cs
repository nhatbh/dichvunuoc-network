using WaterPlatform.BuildingBlocks.Components;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

/// <summary>
/// The component an asset is (decision 0028): a code from the platform catalog, which fixes the
/// asset kind, where it attaches and which properties it may carry. Replaces NodeType/DeviceType.
/// </summary>
public sealed class ComponentCode : ValueObject
{
    public ComponentDefinition Definition { get; }
    public string Value => Definition.Code;

    private ComponentCode(ComponentDefinition definition) => Definition = definition;

    /// <summary>A code of the given kind; throws <see cref="DomainException"/> otherwise.</summary>
    public static ComponentCode Parse(string? value, ComponentKind kind)
        => new(ComponentCatalog.Default.Require(value, kind));

    /// <summary>A code of any kind (the kind follows from the code).</summary>
    public static ComponentCode Parse(string? value) => new(ComponentCatalog.Default.Require(value));

    public static ComponentCode Pipe => Parse("Pipe", ComponentKind.Pipe);
    public static ComponentCode Junction => Parse("Junction", ComponentKind.Node);

    public bool Does(string function) => Definition.Does(function);

    public override string ToString() => Value;

    protected override IEnumerable<object?> GetEqualityComponents() => [Value];
}
