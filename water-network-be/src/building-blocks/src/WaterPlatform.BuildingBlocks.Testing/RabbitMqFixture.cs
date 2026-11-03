using Testcontainers.RabbitMq;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Testing;

public sealed class RabbitMqFixture : IAsyncLifetime
{
    private const string DefaultUsername = "guest";
    private const string DefaultPassword = "guest";
    private readonly RabbitMqContainer _container = new RabbitMqBuilder("rabbitmq:3-management-alpine")
        .WithUsername(DefaultUsername)
        .WithPassword(DefaultPassword)
        .Build();

    public string Host => _container.Hostname;
    public int Port => _container.GetMappedPublicPort(5672);
    public string Username => DefaultUsername;
    public string Password => DefaultPassword;
    public string ConnectionString => $"amqp://{Username}:{Password}@{Host}:{Port}/";

    public Task InitializeAsync() => _container.StartAsync();
    public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}
