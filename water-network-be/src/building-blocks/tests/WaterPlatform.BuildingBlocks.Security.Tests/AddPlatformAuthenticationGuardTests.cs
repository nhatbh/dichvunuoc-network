using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterPlatform.BuildingBlocks.Security;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Security.Tests;

public class AddPlatformAuthenticationGuardTests
{
    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private static IConfiguration BuildConfig(Dictionary<string, string?> values)
        => new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private static FakeHostEnvironment FakeEnvironment(string name)
        => new FakeHostEnvironment { EnvironmentName = name };

    // ---------------------------------------------------------------------------
    // Guard 3: Mock mode in Production → InvalidOperationException
    // ---------------------------------------------------------------------------

    [Fact]
    public void AddPlatformAuthentication_MockMode_InProduction_Throws()
    {
        // Arrange
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Jwt:Mode"] = "Mock",
            ["Jwt:MockSigningKey"] = "test-signing-key-that-is-at-least-32-chars-long!"
        });

        var services = new ServiceCollection();
        var env = FakeEnvironment(Environments.Production);

        // Act
        var act = () => services.AddPlatformAuthentication(config, env);

        // Assert
        act.Should()
           .Throw<InvalidOperationException>()
           .WithMessage("*Mock*must not be used in Production*");
    }

    [Fact]
    public void AddPlatformAuthentication_MockMode_InDevelopment_DoesNotThrow()
    {
        // Arrange
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Jwt:Mode"] = "Mock",
            ["Jwt:MockSigningKey"] = "test-signing-key-that-is-at-least-32-chars-long!"
        });

        var services = new ServiceCollection();
        var env = FakeEnvironment(Environments.Development);

        // Act
        var act = () => services.AddPlatformAuthentication(config, env);

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddPlatformAuthentication_MockMode_NoEnvironment_DoesNotThrow()
    {
        // Arrange (no environment passed — callers that don't opt-in are unaffected)
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Jwt:Mode"] = "Mock",
            ["Jwt:MockSigningKey"] = "test-signing-key-that-is-at-least-32-chars-long!"
        });

        var services = new ServiceCollection();

        // Act
        var act = () => services.AddPlatformAuthentication(config);

        // Assert
        act.Should().NotThrow();
    }

    // ---------------------------------------------------------------------------
    // Guard 4: Authority mode without Authority URL → InvalidOperationException
    // ---------------------------------------------------------------------------

    [Fact]
    public void AddPlatformAuthentication_AuthorityMode_WithoutAuthority_Throws()
    {
        // Arrange
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Jwt:Mode"] = "Authority",
            ["Jwt:Audience"] = "water-platform"
            // Jwt:Authority intentionally absent
        });

        var services = new ServiceCollection();

        // Act
        var act = () => services.AddPlatformAuthentication(config);

        // Assert
        act.Should()
           .Throw<InvalidOperationException>()
           .WithMessage("*Authority*null or empty*");
    }

    [Fact]
    public void AddPlatformAuthentication_AuthorityMode_WithWhitespaceAuthority_Throws()
    {
        // Arrange
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Jwt:Mode"] = "Authority",
            ["Jwt:Authority"] = "   ",
            ["Jwt:Audience"] = "water-platform"
        });

        var services = new ServiceCollection();

        // Act
        var act = () => services.AddPlatformAuthentication(config);

        // Assert
        act.Should()
           .Throw<InvalidOperationException>()
           .WithMessage("*Authority*null or empty*");
    }

    [Fact]
    public void AddPlatformAuthentication_AuthorityMode_WithAuthority_DoesNotThrow()
    {
        // Arrange
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Jwt:Mode"] = "Authority",
            ["Jwt:Authority"] = "https://keycloak.example.com/realms/water-platform",
            ["Jwt:Audience"] = "water-platform"
        });

        var services = new ServiceCollection();

        // Act
        var act = () => services.AddPlatformAuthentication(config);

        // Assert
        act.Should().NotThrow();
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private sealed class FakeHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; }
            = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
