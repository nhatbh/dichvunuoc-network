using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Tests.Outbox;

/// <summary>
/// TDD test for Task A2: OutboxProcessor must restore the stored TenantId onto the
/// published envelope, even when there is no ambient tenant in the background scope.
/// </summary>
public sealed class OutboxProcessorTenantTests
{
    // -------------------------------------------------------------------------
    // Fakes
    // -------------------------------------------------------------------------

    private sealed class CapturingPublisher : IIntegrationEventPublisher
    {
        public string? CapturedTenantId { get; private set; }
        public IIntegrationEvent? CapturedEvent { get; private set; }

        public Task PublishAsync(IIntegrationEvent integrationEvent, string? tenantId = null, CancellationToken ct = default)
        {
            CapturedEvent = integrationEvent;
            CapturedTenantId = tenantId;
            return Task.CompletedTask;
        }
    }

    private sealed class StubIntegrationEvent : IIntegrationEvent
    {
        public string EventId { get; init; } = Guid.NewGuid().ToString();
        public string EventType { get; init; } = "StubEvent";
        public int EventVersion { get; init; } = 1;
        public DateTime OccurredAt { get; init; } = DateTime.UtcNow;
        public string SourceAggregateId { get; init; } = "agg-stub";
        public string SourceAggregateType { get; init; } = "StubAggregate";
    }

    /// <summary>Catch-all mapper that maps any event type and returns a stub integration event.</summary>
    private sealed class CatchAllMapper : IIntegrationEventMapper
    {
        public bool CanMap(string eventType) => true;
        public IIntegrationEvent? Map(IDomainEvent domainEvent) => new StubIntegrationEvent
        {
            SourceAggregateId = domainEvent.AggregateId,
            SourceAggregateType = domainEvent.AggregateType,
        };
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static OutboxProcessor BuildProcessor(IServiceCollection services)
    {
        var sp = services.BuildServiceProvider();
        var scopeFactory = sp.GetRequiredService<IServiceScopeFactory>();
        var logger = NullLogger<OutboxProcessor>.Instance;
        var options = Options.Create(new OutboxOptions { BatchSize = 10, MaxRetries = 3, PollingIntervalSeconds = 60 });
        return new OutboxProcessor(scopeFactory, logger, options);
    }

    // -------------------------------------------------------------------------
    // Test
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Processor_Restores_Entry_Tenant_Onto_Envelope()
    {
        // Arrange
        using var ctx = OutboxTestDbContext.InMemory();

        // Seed an outbox entry with TenantId="tenant-9" directly (no ambient tenant needed here —
        // that was Task A1; we just set the property to confirm the processor passes it through).
        var entry = new OutboxEntry
        {
            Id = Guid.NewGuid().ToString(),
            AggregateId = "agg-1",
            AggregateType = "TestAggregate",
            EventType = "StubEvent",
            EventVersion = 1,
            TenantId = "tenant-9",
            Payload = """{"eventId":"id-1","eventType":"StubEvent","aggregateId":"agg-1","aggregateType":"TestAggregate","occurredAt":"2025-01-01T00:00:00Z","eventVersion":1}""",
            Status = OutboxEntryStatus.Pending,
            CreatedAt = DateTime.UtcNow,
        };
        await ctx.OutboxEntries.AddAsync(entry);
        await ctx.SaveChangesAsync();

        var capturing = new CapturingPublisher();

        // No ambient tenant — simulates the background outbox drain scope.
        var noAmbientTenant = Substitute.For<ITenantContextAccessor>();
        noAmbientTenant.Current.Returns((TenantContext?)null);

        var services = new ServiceCollection();
        // Register the same DbContext instance so the processor reads the seeded entry.
        services.AddSingleton<WaterPlatform.BuildingBlocks.Infrastructure.Persistence.PlatformDbContext>(ctx);
        services.AddScoped<IOutboxRepository>(sp =>
            new OutboxRepository(
                sp.GetRequiredService<WaterPlatform.BuildingBlocks.Infrastructure.Persistence.PlatformDbContext>(),
                noAmbientTenant));
        services.AddSingleton<IIntegrationEventPublisher>(capturing);
        services.AddSingleton<IIntegrationEventMapper>(new CatchAllMapper());

        var processor = BuildProcessor(services);

        // Act — drain
        await processor.ProcessOutboxAsync(CancellationToken.None);

        // Assert — the capturing publisher must have received tenantId == "tenant-9"
        capturing.CapturedEvent.Should().NotBeNull("the entry should have been published");
        capturing.CapturedTenantId.Should().Be("tenant-9");
    }
}
