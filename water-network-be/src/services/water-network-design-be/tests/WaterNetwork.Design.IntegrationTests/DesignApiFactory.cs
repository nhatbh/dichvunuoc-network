using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

public sealed class DesignApiFactory(PostgisFixture postgis) : WebApplicationFactory<Program>
{
    public Dictionary<string, string?> ConfigOverrides { get; } = new();

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:PostgreSQL"] = postgis.ConnectionString,
            ["ConnectionStrings:Redis"] = "",
            ["EventBus:Transport"] = "InMemory",
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["FileStorage:LocalDisk:RootPath"] = Path.Combine(Path.GetTempPath(), "wn-design-it", Guid.CreateVersion7().ToString()),
            ["Jwt:Mode"] = "Mock"
        }));
        if (ConfigOverrides.Count > 0)
            builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(ConfigOverrides));

        var host = base.CreateHost(builder);
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<DesignDbContext>().Database.Migrate();
        return host;
    }
}
