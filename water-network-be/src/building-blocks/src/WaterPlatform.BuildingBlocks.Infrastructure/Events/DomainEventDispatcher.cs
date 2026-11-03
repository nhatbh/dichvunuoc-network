using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Events;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

internal sealed partial class DomainEventDispatcher(
    IServiceProvider serviceProvider,
    ILogger<DomainEventDispatcher> logger) : IDomainEventDispatcher
{
    // Single reflection hop into our own strongly-typed generic method so that exceptions thrown
    // by handlers propagate as-is rather than wrapped in TargetInvocationException.
    // Invoke on an async method returns the Task before it completes; awaiting that Task surfaces
    // the original exception — TargetInvocationException only occurs for synchronous throws
    // before the first await, which cannot happen here since DispatchTypedAsync is fully async.
    private static readonly MethodInfo DispatchTypedMethod = typeof(DomainEventDispatcher)
        .GetMethod(nameof(DispatchTypedAsync), BindingFlags.NonPublic | BindingFlags.Instance)!;

    [LoggerMessage(Level = LogLevel.Error, Message = "Failed to dispatch domain event {EventType} for aggregate {AggregateId}")]
    private static partial void LogDispatchFailed(ILogger logger, Exception ex, string eventType, string aggregateId);

    public async Task DispatchAsync(IEnumerable<IDomainEvent> events, CancellationToken ct = default)
    {
        foreach (var domainEvent in events)
        {
            var task = (Task)DispatchTypedMethod.MakeGenericMethod(domainEvent.GetType())
                .Invoke(this, [domainEvent, ct])!;
            await task; // awaiting surfaces the ORIGINAL exception, not TargetInvocationException
        }
    }

    private async Task DispatchTypedAsync<TEvent>(TEvent domainEvent, CancellationToken ct)
        where TEvent : IDomainEvent
    {
        foreach (var handler in serviceProvider.GetServices<IDomainEventHandler<TEvent>>())
        {
            try
            {
                await handler.HandleAsync(domainEvent, ct);
            }
            catch (Exception ex)
            {
                LogDispatchFailed(logger, ex, domainEvent.EventType, domainEvent.AggregateId);
                throw;
            }
        }
    }
}
