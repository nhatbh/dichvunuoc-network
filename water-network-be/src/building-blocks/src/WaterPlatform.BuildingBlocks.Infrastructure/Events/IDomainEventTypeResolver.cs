namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

/// <summary>
/// Resolves a domain event CLR type from an event-type string.
/// </summary>
/// <remarks>
/// The resolver relies on the convention that the <c>eventType</c> string carried by every
/// <see cref="WaterPlatform.BuildingBlocks.Domain.Events.DomainEventBase{TData}"/> is exactly
/// equal to <c>Type.Name</c> of the concrete record class — e.g. the event
/// <c>NodeDeleted : DomainEventBase&lt;…&gt;</c> stores <c>EventType = "NodeDeleted"</c>.
/// Services MUST register their domain event types via
/// <see cref="ServiceCollectionExtensions.AddOutboxDomainEventTypes"/> or
/// <see cref="ServiceCollectionExtensions.AddOutboxDomainEventTypesFromAssembly"/> for the
/// <see cref="OutboxProcessor"/> to reconstruct concrete events from the outbox payload.
/// </remarks>
public interface IDomainEventTypeResolver
{
    /// <summary>
    /// Attempts to find the CLR <see cref="Type"/> for <paramref name="eventType"/>.
    /// </summary>
    /// <param name="eventType">The event-type string (== concrete record's <c>Type.Name</c>).</param>
    /// <param name="type">
    ///   When this method returns <see langword="true"/>, contains the resolved CLR type;
    ///   otherwise <see langword="null"/>.
    /// </param>
    /// <returns><see langword="true"/> if the type was found; otherwise <see langword="false"/>.</returns>
    bool TryResolve(string eventType, out Type? type);
}
