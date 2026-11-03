using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

/// <summary>
/// Background service that polls the outbox table and publishes pending domain events as
/// integration events via <see cref="IIntegrationEventPublisher"/>.
/// </summary>
/// <remarks>
/// <strong>Delivery guarantee: AT-LEAST-ONCE.</strong>
/// <list type="bullet">
///   <item>There is no SKIP LOCKED / advisory lock, so concurrent processor instances (e.g.
///   multiple replicas) may claim and publish the same entry simultaneously — consumers MUST be
///   idempotent (e.g. via inbox / <see cref="WaterPlatform.BuildingBlocks.Infrastructure.Events.IInboxMessageStore"/>).</item>
///   <item>Entries stuck in <c>Processing</c> status after a crash are not automatically
///   recovered yet. Follow-up: stale-Processing reset (entries older than a configurable
///   threshold should be moved back to <c>Pending</c>).</item>
/// </list>
/// </remarks>
internal sealed partial class OutboxProcessor : BackgroundService, IOutboxProcessor
{
    [LoggerMessage(Level = LogLevel.Error, Message = "Failed to process outbox entry {EntryId}")]
    private static partial void LogProcessFailed(ILogger logger, Exception ex, string entryId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Failed to deserialize outbox entry {EntryId}")]
    private static partial void LogDeserializeFailed(ILogger logger, Exception ex, string entryId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Error occurred while processing outbox")]
    private static partial void LogOutboxError(ILogger logger, Exception ex);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Outbox processor has failed {Count} consecutive times. Suppressing further errors until connection is restored")]
    private static partial void LogConsecutiveFailures(ILogger logger, int count);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Failed to deserialize outbox entry {EntryId} as concrete type {EventType}; falling back to generic carrier")]
    private static partial void LogConcreteDeserializeFallback(ILogger logger, Exception ex, string entryId, string eventType);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OutboxProcessor> _logger;
    private readonly int _batchSize;
    private readonly int _maxRetries;
    private readonly TimeSpan _pollingInterval;

    public OutboxProcessor(
        IServiceScopeFactory scopeFactory,
        ILogger<OutboxProcessor> logger,
        IOptions<OutboxOptions> options)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _batchSize = Math.Max(1, options.Value.BatchSize);
        _maxRetries = Math.Max(1, options.Value.MaxRetries);
        _pollingInterval = TimeSpan.FromSeconds(Math.Max(1, options.Value.PollingIntervalSeconds));
    }

    public async Task ProcessOutboxAsync(CancellationToken ct = default)
    {
        using var scope = _scopeFactory.CreateScope();
        var outboxRepository = scope.ServiceProvider.GetRequiredService<IOutboxRepository>();
        var integrationEventMappers = scope.ServiceProvider.GetServices<IIntegrationEventMapper>();
        var integrationPublisher = scope.ServiceProvider.GetRequiredService<IIntegrationEventPublisher>();
        var resolver = scope.ServiceProvider.GetService<IDomainEventTypeResolver>();

        await outboxRepository.ResetForRetryAsync(_maxRetries, ct);

        var pending = await outboxRepository.GetPendingAsync(_batchSize, ct);

        foreach (var entry in pending)
        {
            try
            {
                await outboxRepository.MarkAsProcessingAsync(entry.Id, ct);

                var mapper = integrationEventMappers.LastOrDefault(m => m.CanMap(entry.EventType))
                    ?? throw new InvalidOperationException($"No integration event mapper registered for event type '{entry.EventType}'.");

                var (domainEvent, concreteFailure) = DeserializeOutboxEvent(entry, resolver);
                if (domainEvent is null)
                    throw new InvalidOperationException($"Outbox entry '{entry.Id}' could not be deserialized.");

                var integrationEvent = mapper.Map(domainEvent);
                if (integrationEvent is null)
                {
                    throw concreteFailure is not null
                        ? new InvalidOperationException(
                            $"Outbox entry '{entry.Id}' (event type '{entry.EventType}') resolved to a concrete domain-event type but its payload failed to deserialize, so only a generic carrier was available and mapper '{mapper.GetType().Name}' could not map it. This is a dead-letter (poison message), not a transient failure — inspect the payload.",
                            concreteFailure)
                        : new InvalidOperationException(
                            $"Mapper '{mapper.GetType().Name}' returned no integration event for '{entry.EventType}'.");
                }

                await integrationPublisher.PublishAsync(integrationEvent, entry.TenantId, ct);

                await outboxRepository.MarkAsProcessedAsync(entry.Id, ct);
            }
            catch (Exception ex)
            {
                LogProcessFailed(_logger, ex, entry.Id);
                await outboxRepository.MarkAsFailedAsync(entry.Id, ex.Message, ct);
            }
        }
    }

    private static readonly JsonSerializerOptions _deserializeOptions =
        new() { PropertyNameCaseInsensitive = true };

    private (IDomainEvent? Event, Exception? ConcreteFailure) DeserializeOutboxEvent(OutboxEntry entry, IDomainEventTypeResolver? resolver)
    {
        Exception? concreteFailure = null;

        // Attempt to reconstruct the concrete domain event type so typed mappers can pattern-match.
        if (resolver is not null && resolver.TryResolve(entry.EventType, out var concreteType) && concreteType is not null)
        {
            try
            {
                var concreteEvent = JsonSerializer.Deserialize(entry.Payload, concreteType, _deserializeOptions) as IDomainEvent;
                if (concreteEvent is not null)
                {
                    return (concreteEvent, null);
                }
            }
            catch (Exception ex)
            {
                LogConcreteDeserializeFallback(_logger, ex, entry.Id, entry.EventType);
                concreteFailure = ex;
                // Fall through to generic carrier below.
            }
        }

        // Fallback: return a generic carrier so that catch-all mappers (e.g. pass-through) still work.
        try
        {
            using var doc = JsonDocument.Parse(entry.Payload);
            var root = doc.RootElement;

            return (new OutboxDomainEvent(
                GetString(root, "eventId", "EventId") ?? entry.Id,
                entry.EventType,
                entry.AggregateId,
                entry.AggregateType,
                GetDateTime(root, "occurredAt", "OccurredAt") ?? entry.CreatedAt,
                entry.Payload,
                entry.EventVersion
            ), concreteFailure);
        }
        catch (JsonException ex)
        {
            LogDeserializeFailed(_logger, ex, entry.Id);
            return (null, concreteFailure);
        }
    }

    private static string? GetString(JsonElement root, string camelCaseName, string pascalCaseName)
    {
        if (root.TryGetProperty(camelCaseName, out var camelCaseValue))
        {
            return camelCaseValue.GetString();
        }

        return root.TryGetProperty(pascalCaseName, out var pascalCaseValue)
            ? pascalCaseValue.GetString()
            : null;
    }

    private static DateTime? GetDateTime(JsonElement root, string camelCaseName, string pascalCaseName)
    {
        if (root.TryGetProperty(camelCaseName, out var camelCaseValue))
        {
            return camelCaseValue.GetDateTime();
        }

        return root.TryGetProperty(pascalCaseName, out var pascalCaseValue)
            ? pascalCaseValue.GetDateTime()
            : null;
    }

    private int _consecutiveErrors;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessOutboxAsync(stoppingToken);
                _consecutiveErrors = 0;
            }
            catch (Exception ex)
            {
                _consecutiveErrors++;
                if (_consecutiveErrors <= 3)
                {
                    LogOutboxError(_logger, ex);
                }
                else if (_consecutiveErrors == 4)
                {
                    LogConsecutiveFailures(_logger, _consecutiveErrors);
                }
            }

            var delay = _consecutiveErrors > 0
                ? TimeSpan.FromSeconds(Math.Min(5 + _consecutiveErrors * 5, 60))
                : _pollingInterval;

            await Task.Delay(delay, stoppingToken);
        }
    }

    public new Task StartAsync(CancellationToken ct = default) => base.StartAsync(ct);

    public new Task StopAsync(CancellationToken ct = default) => base.StopAsync(ct);

    private sealed record OutboxDomainEvent(
        string EventId,
        string EventType,
        string AggregateId,
        string AggregateType,
        DateTime OccurredAt,
        string Payload,
        int EventVersion = 1) : ISerializedDomainEvent
    {
        public IEventMetadata? Metadata { get; init; }
    }
}
