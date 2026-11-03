using System.Text.RegularExpressions;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Domain.ValueObjects;

namespace WaterNetwork.Gis.Domain.ValueObjects;

public sealed partial class AssetCode : ValueObject
{
    public string Value { get; }

    public AssetCode(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 64 || !CodePattern().IsMatch(value))
            throw new DomainException("AssetCode.Invalid", $"Asset code '{value}' is invalid. Expected 1-64 chars of [A-Za-z0-9_-].");
        Value = value;
    }

    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex CodePattern();

    protected override IEnumerable<object?> GetEqualityComponents() => new object?[] { Value };

    public override string ToString() => Value;
}
