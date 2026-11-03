using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.WebApi.Context;
using Xunit;

namespace WaterPlatform.BuildingBlocks.WebApi.Tests;

public class CorrelationIdMiddlewareTests
{
    [Fact]
    public async Task Header_Present_Is_Echoed_And_SetInContext()
    {
        var sink = new CorrelationSink();
        var host = BuildHost(sink, (ctx, _) =>
        {
            if (ctx.Items.TryGetValue("RequestContext", out var raw) && raw is RequestContext rc)
            {
                sink.CorrelationId = rc.CorrelationId;
            }
        });
        await host.StartAsync();
        var client = host.GetTestClient();

        const string supplied = "supplied-corr-id-123";
        client.DefaultRequestHeaders.Add("x-correlation-id", supplied);

        var response = await client.GetAsync("/probe");

        response.Headers.TryGetValues("x-correlation-id", out var echoed).Should().BeTrue();
        echoed!.Should().ContainSingle().Which.Should().Be(supplied);
        sink.CorrelationId.Should().Be(supplied);

        await host.StopAsync();
        host.Dispose();
    }

    [Fact]
    public async Task Header_Missing_Is_Generated()
    {
        var sink = new CorrelationSink();
        var host = BuildHost(sink, (ctx, _) =>
        {
            if (ctx.Items.TryGetValue("RequestContext", out var raw) && raw is RequestContext rc)
            {
                sink.CorrelationId = rc.CorrelationId;
            }
        });
        await host.StartAsync();
        var client = host.GetTestClient();

        var response = await client.GetAsync("/probe");

        response.Headers.TryGetValues("x-correlation-id", out var values).Should().BeTrue();
        values!.Should().ContainSingle().Which.Should().NotBeNullOrEmpty();
        sink.CorrelationId.Should().NotBeNullOrEmpty();
        Guid.TryParse(sink.CorrelationId, out _).Should().BeTrue();

        await host.StopAsync();
        host.Dispose();
    }

    [Fact]
    public async Task Header_Whitespace_Is_Generated()
    {
        var sink = new CorrelationSink();
        var host = BuildHost(sink, (ctx, _) =>
        {
            if (ctx.Items.TryGetValue("RequestContext", out var raw) && raw is RequestContext rc)
            {
                sink.CorrelationId = rc.CorrelationId;
            }
        });
        await host.StartAsync();
        var client = host.GetTestClient();
        client.DefaultRequestHeaders.Add("x-correlation-id", "   ");

        var response = await client.GetAsync("/probe");

        response.Headers.TryGetValues("x-correlation-id", out var values).Should().BeTrue();
        values!.Should().ContainSingle().Which.Should().NotBeNullOrWhiteSpace();
        sink.CorrelationId.Should().NotBeNullOrWhiteSpace();

        await host.StopAsync();
        host.Dispose();
    }

    [Fact]
    public async Task RequestContext_IsStoredInContextItems()
    {
        // Verify the items key the ProblemDetailsWriter reads.
        var sink = new CorrelationSink();
        var host = BuildHost(sink, (ctx, _) =>
        {
            ctx.Items.TryGetValue("RequestContext", out var raw).Should().BeTrue();
            raw.Should().NotBeNull();
            ctx.Response.StatusCode = 200;
        });
        await host.StartAsync();
        var client = host.GetTestClient();
        var response = await client.GetAsync("/probe");
        ((int)response.StatusCode).Should().Be(200);
        await host.StopAsync();
        host.Dispose();
    }

    // ----- helpers -----

    private sealed class CorrelationSink
    {
        public string CorrelationId { get; set; } = string.Empty;
    }

    private static IHost BuildHost(
        CorrelationSink sink,
        Action<HttpContext, CorrelationSink> inspect)
    {
        return new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(s =>
                {
                    s.AddHttpContextAccessor();
                    s.AddSingleton<IRequestContextProvider, RequestContextProvider>();
                });
                web.Configure(app =>
                {
                    app.UseMiddleware<CorrelationIdMiddleware>();
                    app.Run(ctx =>
                    {
                        inspect(ctx, sink);
                        ctx.Response.StatusCode = 200;
                        return Task.CompletedTask;
                    });
                });
            })
            .Build();
    }
}
