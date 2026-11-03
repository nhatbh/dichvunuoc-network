namespace WaterNetwork.Gis.Contracts.Requests;

public sealed record RegisterNodeRequest(string AssetCode, string NodeType, double Latitude, double Longitude);
