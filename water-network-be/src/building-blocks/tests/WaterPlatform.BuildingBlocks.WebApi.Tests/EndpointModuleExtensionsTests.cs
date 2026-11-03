using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using Xunit;

namespace WaterPlatform.BuildingBlocks.WebApi.Tests;

public class EndpointModuleExtensionsTests
{
    [Fact]
    public async Task Parameterless_Module_Is_Mapped()
    {
        var host = BuildHost(
            extraServices: s =>
            {
                // Register DependentModule in DI with a default Dep so the
                // assembly scan finds it via DI, leaving ParameterlessModule
                // to be activated via the parameterless fallback.
                s.AddSingleton<DependentModule>(new DependentModule(new Dep()));
            },
            configure: app =>
            {
                app.UseRouting();
                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapEndpointModules(
                        endpoints.ServiceProvider,
                        typeof(EndpointModuleExtensionsTests).Assembly);
                });
            });
        await host.StartAsync();
        var client = host.GetTestClient();
        var response = await client.GetAsync("/param");
        ((int)response.StatusCode).Should().Be(200);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("parameterless");
        await host.StopAsync();
        host.Dispose();
    }

    [Fact]
    public async Task Module_Registered_In_DI_Is_Resolved_Through_DI()
    {
        var diInstance = new DependentModule(new Dep { Tag = "di-instance" });
        var host = BuildHost(
            extraServices: s =>
            {
                s.AddSingleton<DependentModule>(diInstance);
            },
            configure: app =>
            {
                app.UseRouting();
                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapEndpointModules(
                        endpoints.ServiceProvider,
                        typeof(EndpointModuleExtensionsTests).Assembly);
                });
            });
        await host.StartAsync();
        var client = host.GetTestClient();
        var response = await client.GetAsync("/dep");
        ((int)response.StatusCode).Should().Be(200);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("di-instance");
        await host.StopAsync();
        host.Dispose();
    }

    [Fact]
    public async Task Production_Extension_Prefers_DI_Over_Parameterless()
    {
        // DI-registered instance carries Tag = "di-instance" — proves DI wins.
        var diInstance = new DependentModule(new Dep { Tag = "di-instance" });
        var host = BuildHost(
            extraServices: s =>
            {
                s.AddSingleton<DependentModule>(diInstance);
            },
            configure: app =>
            {
                app.UseRouting();
                app.UseEndpoints(endpoints =>
                {
                    // Mirror the production API: scan the assembly; rely on the
                    // extension's DI-first, parameterless-fallback resolution.
                    endpoints.MapEndpointModules(
                        endpoints.ServiceProvider,
                        typeof(EndpointModuleExtensionsTests).Assembly);
                });
            });
        await host.StartAsync();
        var client = host.GetTestClient();

        // /dep served by DI instance
        var diResponse = await client.GetAsync("/dep");
        diResponse.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        (await diResponse.Content.ReadAsStringAsync()).Should().Contain("di-instance");

        // /param is still mapped via parameterless activation
        var paramResponse = await client.GetAsync("/param");
        paramResponse.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        await host.StopAsync();
        host.Dispose();
    }

    // ----- helpers -----

    private static IHost BuildHost(
        Action<IServiceCollection> extraServices,
        Action<IApplicationBuilder> configure)
    {
        return new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(s =>
                {
                    s.AddRouting();
                    extraServices(s);
                });
                web.Configure(configure);
            })
            .Build();
    }

    public sealed class Dep
    {
        public string Tag { get; init; } = "default";
    }

    public sealed class ParameterlessModule : IEndpointModule
    {
        public void MapEndpoints(IEndpointRouteBuilder app)
        {
            app.MapGet("/param", () => Results.Ok("parameterless"));
        }
    }

    public sealed class DependentModule : IEndpointModule
    {
        private readonly Dep _dep;
        public DependentModule(Dep dep) => _dep = dep;

        public void MapEndpoints(IEndpointRouteBuilder app)
        {
            app.MapGet("/dep", () => Results.Ok(new { tag = _dep.Tag }));
        }
    }
}
