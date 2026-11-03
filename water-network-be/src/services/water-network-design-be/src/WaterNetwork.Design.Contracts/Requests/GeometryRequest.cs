namespace WaterNetwork.Design.Contracts.Requests;

public sealed record GeometryRequest(string Type, IReadOnlyList<IReadOnlyList<double>> Coordinates);
