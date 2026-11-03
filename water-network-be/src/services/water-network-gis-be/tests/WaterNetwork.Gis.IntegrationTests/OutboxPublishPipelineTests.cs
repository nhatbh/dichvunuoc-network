using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Contracts.Events;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

/// <summary>
/// End-to-end test for the outbox → deserialize → map → publish pipeline.
/// <para>
/// This test proves the REAL bug: before the fix, <see cref="OutboxProcessor"/>
/// would deserialize outbox payloads into a generic <c>OutboxDomainEvent</c> carrier,
/// which caused every <c>is ConcreteType</c> type-guard in <see cref="GisIntegrationEventMapper"/>
/// to return <see langword="false"/>, making <c>Map</c> return <see langword="null"/> → every
/// outbox entry was marked Failed and no integration event was ever published.
/// </para>
/// <para>
/// After the fix, <see cref="OutboxProcessor"/> reconstructs the concrete CLR type from the payload
/// (via <see cref="IDomainEventTypeResolver"/>), so typed mappers work correctly.
/// </para>
/// </summary>
public class OutboxPublishPipelineTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    /// <summary>
    /// Capturing publisher that records every integration event published to it.
    /// Registered in DI to replace the real bus publisher during the test.
    /// </summary>
    private sealed class CapturingPublisher : IIntegrationEventPublisher
    {
        private readonly List<IIntegrationEvent> _published = [];

        public IReadOnlyList<IIntegrationEvent> Published => _published;

        public Task PublishAsync(IIntegrationEvent integrationEvent, string? tenantId = null, CancellationToken ct = default)
        {
            _published.Add(integrationEvent);
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task OutboxProcessor_Publishes_Typed_Integration_Event_For_NodeRegistered()
    {
        var publisher = new CapturingPublisher();

        // Override the real IIntegrationEventPublisher with our capturing test double.
        // All other registrations — GisIntegrationEventMapper, AddOutboxDomainEventTypesFromAssembly,
        // OutboxProcessor — remain as wired in production (Program.cs via GisApiFactory).
        await using var factory = new GisApiFactory(postgis)
            .WithWebHostBuilder(b => b.ConfigureServices(services =>
            {
                // Remove any existing IIntegrationEventPublisher registrations and add ours.
                var existing = services
                    .Where(d => d.ServiceType == typeof(IIntegrationEventPublisher))
                    .ToList();
                foreach (var d in existing) services.Remove(d);
                services.AddSingleton<IIntegrationEventPublisher>(publisher);
            }));

        string nodeId;
        string originalEventId;

        // ── 1. Seed: register a node (raises NodeRegistered domain event → outbox entry). ──
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            await db.Database.MigrateAsync();

            var repository = scope.ServiceProvider.GetRequiredService<INetworkNodeRepository>();
            var node = NetworkNode.Register(
                "tenant-outbox-test",
                new AssetCode($"ND-{Guid.NewGuid():N}"[..16]),
                NodeType.Junction,
                new GeoPoint(10.762622, 106.660172));

            await repository.SaveAsync(node);
            nodeId = node.Id;

            // Capture the EventId of the domain event stored in the outbox payload,
            // so we can assert idempotency preservation later.
            var outboxEntry = await db.OutboxEntries
                .FirstOrDefaultAsync(e => e.AggregateId == nodeId && e.EventType == "NodeRegistered");
            outboxEntry.Should().NotBeNull("SaveAsync must have written a NodeRegistered outbox entry");

            var payload = System.Text.Json.JsonDocument.Parse(outboxEntry!.Payload);
            originalEventId = payload.RootElement.GetProperty("EventId").GetString()!;
            originalEventId.Should().NotBeNullOrEmpty("outbox payload must carry the original EventId");
        }

        // ── 1b. Pre-conditions: payload has Data, and the resolver is wired. ──
        // These assertions verify the TWO sub-fixes that together close the bug:
        //   (i)  OutboxRepository now serializes the full concrete event (Data is in payload).
        //   (ii) IDomainEventTypeResolver is registered so OutboxProcessor can reconstruct the type.
        using (var preScope = factory.Services.CreateScope())
        {
            var db = preScope.ServiceProvider.GetRequiredService<GisDbContext>();
            var outboxEntry = await db.OutboxEntries
                .FirstOrDefaultAsync(e => e.AggregateId == nodeId && e.EventType == "NodeRegistered");
            outboxEntry!.Payload.Should().Contain("\"Data\"",
                "sub-fix (i): outbox payload must contain the Data property (runtime-type serialization)");
            outboxEntry.Payload.Should().Contain("TenantId",
                "sub-fix (i): outbox payload must contain full concrete event data");

            var resolver = preScope.ServiceProvider.GetService<IDomainEventTypeResolver>();
            resolver.Should().NotBeNull("sub-fix (ii): IDomainEventTypeResolver must be registered via AddOutboxDomainEventTypesFromAssembly");
            resolver!.TryResolve("NodeRegistered", out var nodeRegisteredType).Should().BeTrue(
                "sub-fix (ii): NodeRegistered must be resolvable from the registry");
            nodeRegisteredType!.Name.Should().Be("NodeRegistered");
        }

        // ── 2. Invoke the outbox processor directly (deterministic — no background timer). ──
        using (var scope = factory.Services.CreateScope())
        {
            var processor = scope.ServiceProvider.GetRequiredService<IOutboxProcessor>();
            await processor.ProcessOutboxAsync(CancellationToken.None);
        }

        // ── 3. Assert: the capturing publisher received the typed integration event. ──
        var publishedForNode = publisher.Published
            .Where(e => e.SourceAggregateId == nodeId)
            .ToList();

        publishedForNode.Should().HaveCount(1, "exactly one NodeRegistered integration event must be published");

        var integrationEvent = publishedForNode[0];

        // (a) EventType must be the integration bus constant, NOT the domain event type string.
        integrationEvent.EventType.Should().Be(GisEventTypes.NodeRegistered,
            "the typed mapper must have transformed the domain event into a NodeRegisteredIntegrationEvent");

        // (b) The original EventId must be preserved (proves init-property round-trip in deserialization).
        integrationEvent.EventId.Should().Be(originalEventId,
            "EventId must be preserved from the original domain event so consumers can deduplicate");

        // (c) The concrete type must NOT be the generic carrier — it must be a typed event record.
        //     We confirm via the type's simple name (the concrete record is NodeRegisteredIntegrationEvent).
        integrationEvent.GetType().Name.Should().Be("NodeRegisteredIntegrationEvent",
            "typed mapper must have returned the concrete integration event record, not a generic carrier");

        // ── 4. Assert the outbox entry is now Processed (not Failed). ──
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            var entry = await db.OutboxEntries
                .FirstOrDefaultAsync(e => e.AggregateId == nodeId && e.EventType == "NodeRegistered");
            entry.Should().NotBeNull();
            entry!.Status.Should().Be(OutboxEntryStatus.Processed,
                "the outbox entry must be marked Processed after successful publish, not Failed");
        }
    }

    /// <summary>
    /// Verifies that when an outbox entry's EventType is resolvable to a concrete CLR type
    /// but the stored payload cannot be deserialized into that type, the processor marks the
    /// entry Failed with a dead-letter message — NOT the misleading "returned no integration
    /// event" message that hid the real root cause before this fix.
    /// </summary>
    [Fact]
    public async Task OutboxProcessor_Marks_DeadLetter_When_ResolvableType_But_PayloadDeserializationFails()
    {
        // We do not need to capture published events for this test — the entry must reach Failed
        // before any publish can occur.

        await using var factory = new GisApiFactory(postgis);

        string poisonEntryId;
        const string aggregateId = "dead-letter-test-aggregate";

        // ── 1. Seed: insert a poison outbox entry directly via the DbContext. ──
        // EventType "NodeRegistered" IS resolvable (the type resolver maps it to NodeRegistered).
        // However, the payload provides "Data" as a JSON number (42) instead of a NodeRegisteredData
        // object — this causes JsonSerializer.Deserialize<NodeRegistered> to throw a JsonException,
        // triggering the concrete-deserialize catch and setting concreteFailure, then falling back
        // to the generic carrier. The GisIntegrationEventMapper then receives the generic carrier,
        // cannot match `e is NodeRegistered`, returns null, and the processor raises the dead-letter
        // InvalidOperationException whose message contains "dead-letter".
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            await db.Database.MigrateAsync();

            var poisonPayload =
                """{"EventId":"00000000-0000-0000-0000-000000000001","EventType":"NodeRegistered","EventVersion":1,"AggregateId":"dead-letter-test-aggregate","AggregateType":"NetworkNode","OccurredAt":"2026-01-01T00:00:00Z","Data":42}""";

            var entry = new OutboxEntry
            {
                AggregateId = aggregateId,
                AggregateType = "NetworkNode",
                EventType = "NodeRegistered",
                EventVersion = 1,
                Payload = poisonPayload,
                Status = OutboxEntryStatus.Pending,
                CreatedAt = DateTime.UtcNow
            };

            await db.OutboxEntries.AddAsync(entry);
            await db.SaveChangesAsync();
            poisonEntryId = entry.Id;
        }

        // ── 2. Run the outbox processor. ──
        using (var scope = factory.Services.CreateScope())
        {
            var processor = scope.ServiceProvider.GetRequiredService<IOutboxProcessor>();
            await processor.ProcessOutboxAsync(CancellationToken.None);
        }

        // ── 3. Assert: the entry is Failed and the stored error message is a dead-letter message. ──
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            var entry = await db.OutboxEntries.FindAsync(poisonEntryId);

            entry.Should().NotBeNull();
            entry!.Status.Should().Be(OutboxEntryStatus.Failed,
                "a poison entry whose payload fails concrete deserialization must be marked Failed");

            entry.LastError.Should().NotBeNullOrEmpty(
                "the processor must persist the error message for the failed entry");

            entry.LastError.Should().Contain("dead-letter",
                "the stored failure message must identify this as a dead-letter (poison message), " +
                "not the misleading generic 'returned no integration event' message");

            entry.LastError.Should().Contain("NodeRegistered",
                "the dead-letter message must include the event type so operators can identify the entry");
        }
    }
}
