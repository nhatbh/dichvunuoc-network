using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public sealed partial class IdempotencyService : IIdempotencyService
{
    [LoggerMessage(Level = LogLevel.Error, Message = "Failed to deserialize idempotency result for key {Key}")]
    private static partial void LogDeserializeFailed(ILogger logger, Exception ex, string key);

    private readonly PlatformDbContext _dbContext;
    private readonly ILogger<IdempotencyService> _logger;

    public IdempotencyService(PlatformDbContext dbContext, ILogger<IdempotencyService> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task<bool> HasBeenProcessedAsync(string idempotencyKey, CancellationToken ct = default)
    {
        return await _dbContext.Set<IdempotencyEntry>()
            .AnyAsync(e => e.Key == idempotencyKey, ct);
    }

    public async Task MarkAsProcessedAsync(string idempotencyKey, string result, CancellationToken ct = default)
    {
        var entry = new IdempotencyEntry
        {
            Key = idempotencyKey,
            Result = result,
            ProcessedAt = DateTime.UtcNow
        };

        _dbContext.Set<IdempotencyEntry>().Add(entry);
        await _dbContext.SaveChangesAsync(ct);
    }

    public async Task<TResult?> GetResultAsync<TResult>(string idempotencyKey, CancellationToken ct = default)
    {
        var entry = await _dbContext.Set<IdempotencyEntry>()
            .FirstOrDefaultAsync(e => e.Key == idempotencyKey, ct);

        if (entry is null || entry.Result is null) return default;

        try
        {
            return JsonSerializer.Deserialize<TResult>(entry.Result);
        }
        catch (JsonException ex)
        {
            LogDeserializeFailed(_logger, ex, idempotencyKey);
            return default;
        }
    }
}

public sealed class IdempotencyEntry
{
    public string Key { get; set; } = default!;
    public string? Result { get; set; }
    public DateTime ProcessedAt { get; set; }
}
