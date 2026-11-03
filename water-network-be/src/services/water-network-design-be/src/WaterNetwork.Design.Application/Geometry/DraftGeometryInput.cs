// DraftGeometryInput.cs
namespace WaterNetwork.Design.Application.Geometry;

/// <summary>GeoJSON-shaped geometry input: Type is "Point" or "LineString"; Coordinates is a
/// list of [longitude, latitude] pairs (one for Point, two-or-more for LineString).</summary>
public sealed record DraftGeometryInput(string Type, IReadOnlyList<IReadOnlyList<double>> Coordinates);
