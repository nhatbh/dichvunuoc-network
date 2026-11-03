using Testcontainers.PostgreSql;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Testing;

public sealed class PostgisFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgis/postgis:16-3.4-alpine")
        .WithDatabase("wn_test")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    public string ConnectionString => _container.GetConnectionString();

    public Task InitializeAsync() => _container.StartAsync();
    public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}
