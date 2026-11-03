namespace WaterNetwork.Gis.Contracts.Requests;

/// <summary>
/// Bound from the query string via [AsParameters].
///   bbox  = "minLng,minLat,maxLng,maxLat"
///   types = "node,pipe,device" (optional; default = all three)
///   limit = int (optional; default from config)
/// </summary>
public sealed record GetAssetsInBboxRequest(string? Bbox, string? Types, int? Limit);
