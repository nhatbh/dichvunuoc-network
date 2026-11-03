namespace WaterPlatform.BuildingBlocks.WebApi.Http;

public sealed record PaginationDto(
    int Page = 1,
    int Limit = 20,
    string? SortBy = null,
    string SortOrder = "asc"
)
{
    public int Skip => (Page - 1) * Limit;
    public int Take => Limit;
}

public sealed record PaginatedResponse<T>(
    IReadOnlyList<T> Data,
    PaginationMeta Meta
);

public sealed record PaginationMeta(
    int Page,
    int Limit,
    long Total,
    int TotalPages,
    bool HasNextPage,
    bool HasPreviousPage
);
