namespace WaterPlatform.BuildingBlocks.Infrastructure.Events;

/// <summary>
/// Immutable-after-build registry that maps event-type strings to CLR types.
/// Backed by a <see cref="Dictionary{TKey,TValue}"/> with ordinal comparison.
/// </summary>
/// <remarks>
/// Duplicate registrations with the same key are silently ignored (last-seen wins at build time,
/// not at runtime); the registry never throws for duplicates with the identical CLR type.
/// </remarks>
internal sealed class DomainEventTypeRegistry : IDomainEventTypeResolver
{
    private readonly Dictionary<string, Type> _map;

    internal DomainEventTypeRegistry(Dictionary<string, Type> map)
    {
        _map = map;
    }

    /// <inheritdoc/>
    public bool TryResolve(string eventType, out Type? type)
        => _map.TryGetValue(eventType, out type);
}
