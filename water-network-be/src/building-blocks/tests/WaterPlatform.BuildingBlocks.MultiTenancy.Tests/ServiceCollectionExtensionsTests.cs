using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace WaterPlatform.BuildingBlocks.MultiTenancy.Tests;

public sealed class ServiceCollectionExtensionsTests
{
    [Fact]
    public void Production_Rejects_Header_Fallback_Even_When_Misconfigured()
    {
        var configuration = Configuration(new Dictionary<string, string?>
        {
            ["MultiTenancy:AllowHeaderFallback"] = "true"
        });
        var services = new ServiceCollection();
        services.AddPlatformMultiTenancy(configuration, Environment(Environments.Production));
        using var provider = services.BuildServiceProvider();

        var act = () => provider.GetRequiredService<IOptions<TenantOptions>>().Value;

        act.Should().Throw<OptionsValidationException>()
            .WithMessage("*AllowHeaderFallback must be false in Production*");
    }

    [Fact]
    public void Development_Can_Explicitly_Enable_Header_And_Flat_Compatibility()
    {
        var configuration = Configuration(new Dictionary<string, string?>
        {
            ["MultiTenancy:AllowHeaderFallback"] = "true",
            ["MultiTenancy:AllowFlatTenantClaimCompatibility"] = "true"
        });
        var services = new ServiceCollection();
        services.AddPlatformMultiTenancy(configuration, Environment(Environments.Development));
        using var provider = services.BuildServiceProvider();

        var options = provider.GetRequiredService<IOptions<TenantOptions>>().Value;

        options.AllowHeaderFallback.Should().BeTrue();
        options.AllowFlatTenantClaimCompatibility.Should().BeTrue();
    }

    [Fact]
    public void Production_Allows_Signed_Flat_Compatibility_During_Controlled_Transition()
    {
        var configuration = Configuration(new Dictionary<string, string?>
        {
            ["MultiTenancy:AllowHeaderFallback"] = "false",
            ["MultiTenancy:AllowFlatTenantClaimCompatibility"] = "true"
        });
        var services = new ServiceCollection();
        services.AddPlatformMultiTenancy(configuration, Environment(Environments.Production));
        using var provider = services.BuildServiceProvider();

        var options = provider.GetRequiredService<IOptions<TenantOptions>>().Value;

        options.AllowFlatTenantClaimCompatibility.Should().BeTrue();
    }

    [Fact]
    public void Empty_Claim_Name_Is_Rejected_By_Options_Validation()
    {
        var configuration = Configuration(new Dictionary<string, string?>
        {
            ["MultiTenancy:OrganizationClaim"] = " "
        });
        var services = new ServiceCollection();
        services.AddPlatformMultiTenancy(configuration, Environment(Environments.Development));
        using var provider = services.BuildServiceProvider();

        var act = () => provider.GetRequiredService<IOptions<TenantOptions>>().Value;

        act.Should().Throw<OptionsValidationException>()
            .WithMessage("*claim, attribute, and header names must not be empty*");
    }

    private static IConfiguration Configuration(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private static FakeHostEnvironment Environment(string name) => new()
    {
        EnvironmentName = name
    };

    private sealed class FakeHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "MultiTenancy.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
