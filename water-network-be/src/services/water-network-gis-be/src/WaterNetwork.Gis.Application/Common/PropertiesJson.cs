using System.Text.Json;

namespace WaterNetwork.Gis.Application.Common;

/// <summary>Reads and writes the <c>properties</c> jsonb column (a flat string dictionary).</summary>
public static class PropertiesJson
{
    private static readonly IReadOnlyDictionary<string, string> Empty =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public static IReadOnlyDictionary<string, string> Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Empty;
        return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? Empty;
    }

    public static string Write(IReadOnlyDictionary<string, string> values) =>
        JsonSerializer.Serialize(values);
}
