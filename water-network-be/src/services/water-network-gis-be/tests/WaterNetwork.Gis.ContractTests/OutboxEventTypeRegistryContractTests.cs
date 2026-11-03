using System.Linq;
using System.Reflection;
using FluentAssertions;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using Xunit;

namespace WaterNetwork.Gis.ContractTests;

/// <summary>
/// Guards the convention required by <see cref="IDomainEventTypeResolver"/>:
/// for every GIS domain event, the <c>EventType</c> string stored on the event MUST equal
/// the record's <c>Type.Name</c>.  Breaking this convention would silently prevent the
/// <see cref="OutboxProcessor"/> from reconstructing the concrete type and typed integration
/// event mappers would never fire.
/// </summary>
public class OutboxEventTypeRegistryContractTests
{
    private static readonly Assembly GisDomainAssembly = typeof(NodeRegistered).Assembly;

    private static IEnumerable<Type> AllGisDomainEventTypes()
        => GisDomainAssembly.GetTypes()
            .Where(t => !t.IsAbstract && typeof(IDomainEvent).IsAssignableFrom(t));

    [Fact]
    public void All_GIS_Domain_Events_Satisfy_EventType_Equals_TypeName_Convention()
    {
        var violations = new List<string>();

        foreach (var type in AllGisDomainEventTypes())
        {
            // Instantiate a minimal event to read the EventType property.
            // All GIS domain events are positional records with (AggregateId, Data).
            // Use reflection to find and call the primary constructor.
            try
            {
                var instance = CreateMinimalInstance(type);
                if (instance is IDomainEvent domainEvent && domainEvent.EventType != type.Name)
                {
                    violations.Add($"{type.Name}: EventType='{domainEvent.EventType}' (expected '{type.Name}')");
                }
            }
            catch (Exception ex)
            {
                violations.Add($"{type.Name}: could not instantiate — {ex.Message}");
            }
        }

        violations.Should().BeEmpty(
            $"all GIS domain events must have EventType == Type.Name so the outbox type resolver can reconstruct them. Violations: {string.Join(", ", violations)}");
    }

    [Fact]
    public void DomainEventTypeRegistry_TryResolve_Hit_Returns_True_And_Type()
    {
        // Build a minimal registry with two entries.
        var map = new Dictionary<string, Type>(StringComparer.Ordinal)
        {
            [nameof(NodeRegistered)] = typeof(NodeRegistered),
            [nameof(NodeDeleted)] = typeof(NodeDeleted),
        };

        // Use the internal registry via the public interface.
        // We must use reflection to call the internal ctor because DomainEventTypeRegistry is internal.
        var registryType = typeof(IDomainEventTypeResolver).Assembly
            .GetType("WaterPlatform.BuildingBlocks.Infrastructure.Events.DomainEventTypeRegistry")!;
        registryType.Should().NotBeNull("DomainEventTypeRegistry must exist in the assembly");

        var ctor = registryType.GetConstructors(BindingFlags.NonPublic | BindingFlags.Instance).FirstOrDefault();
        ctor.Should().NotBeNull("DomainEventTypeRegistry must have an internal constructor");

        var registry = (IDomainEventTypeResolver)ctor!.Invoke([map]);

        // Hit
        registry.TryResolve(nameof(NodeRegistered), out var resolved).Should().BeTrue();
        resolved.Should().BeSameAs(typeof(NodeRegistered));

        // Miss
        registry.TryResolve("NonExistent", out var notFound).Should().BeFalse();
        notFound.Should().BeNull();

        // Hit — other entry
        registry.TryResolve(nameof(NodeDeleted), out var nodeDeleted).Should().BeTrue();
        nodeDeleted.Should().BeSameAs(typeof(NodeDeleted));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Creates a minimal instance of a GIS domain event type so we can read its EventType property.
    /// GIS events are positional records inheriting from DomainEventBase; they have two constructor
    /// parameters: (string AggregateId, TData Data).
    /// </summary>
    private static object? CreateMinimalInstance(Type eventType)
    {
        var ctors = eventType.GetConstructors();
        // Find the shortest constructor (the primary record constructor has 2 params).
        var ctor = ctors.MinBy(c => c.GetParameters().Length)!;
        var args = ctor.GetParameters().Select(p => GetMinimalValue(p.ParameterType)).ToArray();
        return ctor.Invoke(args);
    }

    private static object? GetMinimalValue(Type type)
    {
        if (type == typeof(string)) return "test";
        if (type.IsValueType) return Activator.CreateInstance(type);
        if (type == typeof(string[])) return Array.Empty<string>();
        // For data records, recurse with their shortest constructor.
        var ctor = type.GetConstructors().MinBy(c => c.GetParameters().Length);
        if (ctor is not null)
        {
            var args = ctor.GetParameters().Select(p => GetMinimalValue(p.ParameterType)).ToArray();
            return ctor.Invoke(args);
        }
        return null;
    }
}
