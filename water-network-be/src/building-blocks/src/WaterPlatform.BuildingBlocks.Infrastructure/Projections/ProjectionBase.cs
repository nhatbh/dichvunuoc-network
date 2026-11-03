using WaterPlatform.BuildingBlocks.Application.Projections;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Projections;

/// <summary>
/// Base class for read-model projections that track processed events to ensure idempotency.
/// </summary>
/// <remarks>
/// <strong>In-memory fallback:</strong> Until <see cref="SetEventStore"/> is called with a
/// persistent <see cref="IProcessedEventStore"/>, processed-event tracking is kept in a plain
/// <see cref="HashSet{T}"/> on this instance.  This state is lost on application restart, so the
/// projection will re-process events it has already handled.  Wire up a persistent event store
/// (e.g. via the infrastructure DI registration) to guarantee durable idempotency across
/// restarts.
/// </remarks>
public abstract class ProjectionBase : IProjection
{
    private readonly HashSet<string> _processedEvents = [];
    private IProcessedEventStore? _eventStore;

    public abstract string Name { get; }

    internal void SetEventStore(IProcessedEventStore eventStore) => _eventStore = eventStore;

    protected async Task<bool> IsEventProcessedAsync(string eventId)
    {
        if (_eventStore is not null)
            return await _eventStore.HasBeenProcessedAsync(Name, eventId);

        return _processedEvents.Contains(eventId);
    }

    protected async Task MarkEventProcessedAsync(string eventId)
    {
        if (_eventStore is not null)
        {
            await _eventStore.MarkAsProcessedAsync(Name, eventId);
            return;
        }

        _processedEvents.Add(eventId);
    }

    protected abstract Task HandleEventAsync<TEvent>(TEvent domainEvent, CancellationToken ct);

    public async Task SafeHandleAsync<TEvent>(TEvent domainEvent, string eventId, CancellationToken ct)
    {
        if (await IsEventProcessedAsync(eventId)) return;
        try
        {
            await HandleEventAsync(domainEvent, ct);
            await MarkEventProcessedAsync(eventId);
        }
        catch (Exception ex)
        {
            HandleError(ex);
            throw;
        }
    }

    protected virtual void HandleError(Exception ex) { }
}
