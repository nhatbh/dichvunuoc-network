using Microsoft.Extensions.Configuration;
using RabbitMQ.Client;

namespace WaterPlatform.BuildingBlocks.Observability;

/// <summary>A failed first probe is retried; only a currently open connection is reused.</summary>
public sealed class RecoveringRabbitMqConnection(Func<Task<IConnection>> connect) : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IConnection? _connection;
    private bool _disposed;

    public async Task<IConnection> GetAsync()
    {
        await _gate.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_connection?.IsOpen == true) return _connection;
            _connection?.Dispose();
            _connection = null;
            // Never retain a failed Task: the next health probe must be able to reconnect.
            _connection = await connect();
            return _connection;
        }
        finally { _gate.Release(); }
    }

    public static ConnectionFactory CreateFactory(IConfiguration configuration) => new()
    {
        HostName = configuration["MassTransit:RabbitMq:Host"] ?? "localhost",
        Port = configuration.GetValue<int?>("MassTransit:RabbitMq:Port") ?? 5672,
        UserName = configuration["MassTransit:RabbitMq:Username"] ?? "guest",
        Password = configuration["MassTransit:RabbitMq:Password"] ?? "guest",
        VirtualHost = configuration["MassTransit:RabbitMq:VirtualHost"] ?? "/",
        RequestedConnectionTimeout = TimeSpan.FromSeconds(5)
    };

    public void Dispose()
    {
        _gate.Wait();
        try
        {
            if (_disposed) return;
            _disposed = true;
            _connection?.Dispose();
            _connection = null;
        }
        finally { _gate.Release(); }
        // Keep the gate available so an in-flight probe observes ObjectDisposedException
        // instead of racing a disposed semaphore during host shutdown.
    }
}
