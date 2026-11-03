using Xunit;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using NSubstitute;
using RabbitMQ.Client;
using WaterPlatform.BuildingBlocks.Observability;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Tests;

public sealed class RecoveringRabbitMqConnectionTests
{
    [Fact]
    public async Task Failed_initial_DNS_connection_does_not_poison_subsequent_health_checks()
    {
        var connection = Substitute.For<IConnection>();
        connection.IsOpen.Returns(true);
        var calls = 0;
        using var cache = new RecoveringRabbitMqConnection(() => ++calls == 1
            ? Task.FromException<IConnection>(new IOException("DNS unavailable during startup"))
            : Task.FromResult(connection));
        await FluentActions.Invoking(() => cache.GetAsync()).Should().ThrowAsync<IOException>();
        (await cache.GetAsync()).Should().BeSameAs(connection);
        (await cache.GetAsync()).Should().BeSameAs(connection);
        calls.Should().Be(2);
    }

    [Fact]
    public async Task Closed_connection_is_replaced_and_parallel_probes_share_the_replacement()
    {
        var first = Substitute.For<IConnection>();
        first.IsOpen.Returns(true);
        var replacement = Substitute.For<IConnection>();
        replacement.IsOpen.Returns(true);
        var calls = 0;
        using var cache = new RecoveringRabbitMqConnection(async () =>
        {
            await Task.Delay(5);
            return Interlocked.Increment(ref calls) == 1 ? first : replacement;
        });
        (await cache.GetAsync()).Should().BeSameAs(first);
        first.IsOpen.Returns(false);
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => cache.GetAsync()));
        results.Should().OnlyContain(x => ReferenceEquals(x, replacement));
        calls.Should().Be(2);
        first.Received(1).Dispose();
    }

    [Fact]
    public void Credentials_with_URI_delimiters_are_passed_as_literal_fields()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MassTransit:RabbitMq:Host"] = "rabbitmq",
            ["MassTransit:RabbitMq:Username"] = "operator@network",
            ["MassTransit:RabbitMq:Password"] = "x:/?#@%",
            ["MassTransit:RabbitMq:VirtualHost"] = "/water"
        }).Build();
        var factory = RecoveringRabbitMqConnection.CreateFactory(config);
        factory.HostName.Should().Be("rabbitmq");
        factory.UserName.Should().Be("operator@network");
        factory.Password.Should().Be("x:/?#@%");
        factory.VirtualHost.Should().Be("/water");
    }
}
