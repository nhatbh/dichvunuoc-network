using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WaterPlatform.BuildingBlocks.Domain.Events;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Tests.Outbox;

public sealed class OutboxTenantStampTests
{
    private sealed record SampleData(string Value);
    private sealed record SampleEvent(string AggregateId, SampleData Data)
        : DomainEventBase<SampleData>(AggregateId, "Sample", "SampleEvent", Data);

    [Fact]
    public async Task AddManyAsync_Stamps_Ambient_TenantId_On_Entry()
    {
        // Arrange an in-memory PlatformDbContext-backed OutboxRepository with a tenant in scope.
        var tenant = Substitute.For<ITenantContextAccessor>();
        tenant.Current.Returns(new TenantContext("tenant-42"));

        using var ctx = OutboxTestDbContext.InMemory();
        var repo = new OutboxRepository(ctx, tenant);

        await repo.AddManyAsync([new SampleEvent("agg-1", new SampleData("x"))]);
        await ctx.SaveChangesAsync();

        var entry = await ctx.OutboxEntries.SingleAsync();
        entry.TenantId.Should().Be("tenant-42");
    }

    [Fact]
    public async Task AddAsync_Stamps_Ambient_TenantId_On_Entry()
    {
        var tenant = Substitute.For<ITenantContextAccessor>();
        tenant.Current.Returns(new TenantContext("tenant-99"));

        using var ctx = OutboxTestDbContext.InMemory();
        var repo = new OutboxRepository(ctx, tenant);

        await repo.AddAsync(new SampleEvent("agg-2", new SampleData("y")));
        await ctx.SaveChangesAsync();

        var entry = await ctx.OutboxEntries.SingleAsync();
        entry.TenantId.Should().Be("tenant-99");
    }

    [Fact]
    public async Task AddManyAsync_No_Tenant_In_Scope_Leaves_TenantId_Null()
    {
        var tenant = Substitute.For<ITenantContextAccessor>();
        tenant.Current.Returns((TenantContext?)null);

        using var ctx = OutboxTestDbContext.InMemory();
        var repo = new OutboxRepository(ctx, tenant);

        await repo.AddManyAsync([new SampleEvent("agg-3", new SampleData("z"))]);
        await ctx.SaveChangesAsync();

        var entry = await ctx.OutboxEntries.SingleAsync();
        entry.TenantId.Should().BeNull();
    }
}
