using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Gis.IntegrationTests;

public sealed class GisApiFactory(PostgisFixture postgis) : WebApplicationFactory<Program>
{
    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:PostgreSQL"] = postgis.ConnectionString,
            ["ConnectionStrings:Redis"] = "",
            ["EventBus:Transport"] = "InMemory",
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["Jwt:Mode"] = "Mock"
        }));
        var host = base.CreateHost(builder);

        // Integration tests share a single PostGIS container; apply migrations on the
        // first host build. Migrate() is a no-op once the schema is up-to-date.
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<GisDbContext>().Database.Migrate();

        return host;
    }
}
