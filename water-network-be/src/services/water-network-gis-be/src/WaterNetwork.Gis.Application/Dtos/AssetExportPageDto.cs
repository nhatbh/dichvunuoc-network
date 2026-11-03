namespace WaterNetwork.Gis.Application.Dtos;

/// <summary>One page of the topology rebuild export, keyset-paginated by id.</summary>
public sealed record AssetExportPageDto(
    IReadOnlyList<AssetExportItemDto> Items,
    string? NextCursor); // null when the last page is reached

public sealed record AssetExportItemDto(
    string Kind,            // Node | Pipe | Device
    string Id,
    string AssetCode,
    string? NodeType,       // Node
    string? FromNodeId,     // Pipe
    string? ToNodeId,       // Pipe
    int? DiameterMm,        // Pipe
    string? Material,       // Pipe
    double? LengthM,        // Pipe
    string? DeviceType,     // Device
    string? HostPipeId,     // Device
    string? HostNodeId);    // Device
