using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using WaterPlatform.BuildingBlocks.Application.Queries;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Application.Tests;

public sealed record GetThingQuery(string Id) : IQuery<string?>;

public sealed class GetThingHandler : IQueryHandler<GetThingQuery, string?>
{
    public Task<string?> HandleAsync(GetThingQuery query, CancellationToken ct)
        => Task.FromResult<string?>(query.Id == "known" ? "thing" : null);
}

public class QueryBusTests
{
    [Fact]
    public async Task ExecuteAsync_Resolves_Query_Handler()
    {
        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        services.AddScoped<IQueryHandler<GetThingQuery, string?>, GetThingHandler>();
        await using var sp = services.BuildServiceProvider();
        var bus = sp.GetRequiredService<IQueryBus>();
        (await bus.ExecuteAsync(new GetThingQuery("known"))).Should().Be("thing");
        (await bus.ExecuteAsync(new GetThingQuery("other"))).Should().BeNull();
    }
}
