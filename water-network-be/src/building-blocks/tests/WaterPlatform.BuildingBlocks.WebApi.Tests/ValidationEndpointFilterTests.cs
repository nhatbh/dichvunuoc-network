using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using FluentValidation;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.WebApi.Context;
using WaterPlatform.BuildingBlocks.WebApi.Validation;
using Xunit;

namespace WaterPlatform.BuildingBlocks.WebApi.Tests;

public class ValidationEndpointFilterTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    [Fact]
    public async Task InvalidRequest_Returns_400_ProblemDetails()
    {
        var host = BuildHost(services =>
        {
            services.AddScoped<IValidator<CreateThingRequest>, FailingValidator>();
        }, endpoints =>
        {
            endpoints.MapPost("/things", (CreateThingRequest req) => Results.Ok("ok"))
                .WithValidation<CreateThingRequest>();
        });

        await host.StartAsync();
        var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/things", new CreateThingRequest(""));

        ((int)response.StatusCode).Should().Be(400);
        response.Content.Headers.ContentType?.MediaType
            .Should().Be("application/problem+json");

        var body = await response.Content.ReadAsStringAsync();
        var problem = JsonSerializer.Deserialize<JsonElement>(body, JsonOptions);

        problem.GetProperty("status").GetInt32().Should().Be(400);
        problem.GetProperty("title").GetString().Should().Be("Validation failed");
        problem.GetProperty("code").GetString().Should().Be("VALIDATION_FAILED");
        problem.GetProperty("instance").GetString().Should().Be("/things");
        problem.TryGetProperty("correlationId", out _).Should().BeTrue();

        var errors = problem.GetProperty("errors");
        // FluentValidation keys are the original C# property names. Confirm
        // the errors dict contains an entry for the failing field.
        var hasName = errors.TryGetProperty("Name", out _)
                      || errors.TryGetProperty("name", out _);
        hasName.Should().BeTrue("validation errors should include the failing field");

        await host.StopAsync();
        host.Dispose();
    }

    [Fact]
    public async Task ValidRequest_Handler_Is_Invoked()
    {
        var host = BuildHost(services =>
        {
            services.AddScoped<IValidator<CreateThingRequest>, FailingValidator>();
        }, endpoints =>
        {
            endpoints.MapPost("/things", (CreateThingRequest req) =>
                    Results.Ok(new { echoed = req.Name }))
                .WithValidation<CreateThingRequest>();
        });

        await host.StartAsync();
        var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/things", new CreateThingRequest("ok"));

        ((int)response.StatusCode).Should().Be(200);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("\"echoed\":\"ok\"");

        await host.StopAsync();
        host.Dispose();
    }

    [Fact]
    public async Task NoValidatorRegistered_Handler_Is_Invoked()
    {
        var host = BuildHost(_ => { }, endpoints =>
        {
            endpoints.MapPost("/things", (CreateThingRequest req) =>
                    Results.Ok(new { echoed = req.Name }))
                .WithValidation<CreateThingRequest>();
        });

        await host.StartAsync();
        var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/things", new CreateThingRequest("anything"));

        ((int)response.StatusCode).Should().Be(200);

        await host.StopAsync();
        host.Dispose();
    }

    // ----- helpers -----

    private static IHost BuildHost(
        Action<IServiceCollection> configureServices,
        Action<IEndpointRouteBuilder> mapEndpoints)
    {
        return new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(s =>
                {
                    s.AddHttpContextAccessor();
                    s.AddRouting();
                    s.AddSingleton<IRequestContextProvider, RequestContextProvider>();
                    configureServices(s);
                });
                web.Configure(app =>
                {
                    // CorrelationIdMiddleware populates context.Items so the
                    // ProblemDetailsWriter can include the correlation ID.
                    app.UseMiddleware<CorrelationIdMiddleware>();
                    app.UseRouting();
                    app.UseEndpoints(mapEndpoints);
                });
            })
            .Build();
    }

    public sealed record CreateThingRequest(string Name);

    public sealed class FailingValidator : AbstractValidator<CreateThingRequest>
    {
        public FailingValidator()
        {
            RuleFor(x => x.Name).NotEmpty();
        }
    }
}
