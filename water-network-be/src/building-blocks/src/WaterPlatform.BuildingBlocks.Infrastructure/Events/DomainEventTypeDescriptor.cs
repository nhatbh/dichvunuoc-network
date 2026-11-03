namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

/// <summary>
/// Internal value holder that carries a single (eventType → CLR type) mapping.
/// Registered as a singleton via DI so that multiple
/// <see cref="ServiceCollectionExtensions.AddOutboxDomainEventTypes"/> /
/// <see cref="ServiceCollectionExtensions.AddOutboxDomainEventTypesFromAssembly"/> calls
/// accumulate entries that the <see cref="DomainEventTypeRegistry"/> factory then reads once.
/// </summary>
internal sealed record DomainEventTypeDescriptor(string EventType, Type ClrType);
