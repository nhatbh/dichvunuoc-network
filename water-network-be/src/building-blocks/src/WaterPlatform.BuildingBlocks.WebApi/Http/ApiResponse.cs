namespace WaterPlatform.BuildingBlocks.WebApi.Http;

public sealed record ApiResponse<T>(
    bool Success,
    int StatusCode,
    DateTime Timestamp,
    string? Path = null,
    string? Method = null,
    T? Data = default,
    string? Message = null
);

/// <summary>
/// Non-generic factory helpers for <see cref="ApiResponse{T}"/> (CA1000: avoid static members on generic types).
/// </summary>
public static class ApiResponse
{
    public static ApiResponse<T> Ok<T>(T data, string? path = null, string? method = null)
        => new(true, 200, DateTime.UtcNow, path, method, data);

    public static ApiResponse<T> Created<T>(T data, string? path = null, string? method = null)
        => new(true, 201, DateTime.UtcNow, path, method, data);

    public static ApiResponse<object> NoContent(string? path = null, string? method = null)
        => new(true, 204, DateTime.UtcNow, path, method);
}
