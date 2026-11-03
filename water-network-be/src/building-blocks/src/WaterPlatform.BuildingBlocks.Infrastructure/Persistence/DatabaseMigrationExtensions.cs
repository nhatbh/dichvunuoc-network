using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public static partial class DatabaseMigrationExtensions
{
    [LoggerMessage(Level = LogLevel.Debug, Message = "Skipping migrations: database provider is not relational.")]
    private static partial void LogSkippingMigrations(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Applying EF Core migrations...")]
    private static partial void LogApplyingMigrations(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "EF Core migrations applied.")]
    private static partial void LogMigrationsApplied(ILogger logger);

    /// <summary>
    /// Applies EF Core migrations on startup when the host environment is not "Testing"
    /// and <c>Database:ApplyMigrationsOnStartup</c> is not set to false. Pass
    /// <paramref name="force"/> for an explicit migration-only process so the
    /// runtime safety setting cannot turn a migration Job into a successful no-op.
    /// Call this on <see cref="IHost"/> before <c>Run()</c>.
    /// </summary>
    public static IHost ApplyDatabaseMigrations(this IHost host, bool force = false)
    {
        var env = host.Services.GetRequiredService<IHostEnvironment>();
        if (env.IsEnvironment("Testing"))
        {
            return host;
        }

        var config = host.Services.GetRequiredService<IConfiguration>();
        var applyOnStartup = config.GetValue("Database:ApplyMigrationsOnStartup", defaultValue: true);
        if (!force && !applyOnStartup)
        {
            return host;
        }

        using var scope = host.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<PlatformDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<PlatformDbContext>>();

        if (!dbContext.Database.IsRelational())
        {
            LogSkippingMigrations(logger);
            return host;
        }

        LogApplyingMigrations(logger);
        dbContext.Database.Migrate();
        LogMigrationsApplied(logger);

        return host;
    }
}
