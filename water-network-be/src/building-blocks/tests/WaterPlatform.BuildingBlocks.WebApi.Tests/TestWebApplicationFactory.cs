using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.WebApi.Context;
using WaterPlatform.BuildingBlocks.WebApi.Http;

namespace WaterPlatform.BuildingBlocks.WebApi.Tests;

/// <summary>
/// Test host that wires the platform middleware and exposes a single
/// dispatching endpoint so each exception-mapping test can ask for a
/// specific failure mode. Built on <see cref="TestServer"/> to avoid the
/// <c>WebApplicationFactory</c> entry-point dance.
/// </summary>
public sealed class TestWebApplicationFactory : IAsyncDisposable
{
    private readonly IHost _host;

    public TestWebApplicationFactory()
    {
        _host = new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddHttpContextAccessor();
                    services.AddSingleton<IRequestContextProvider, RequestContextProvider>();
                });
                web.Configure(app =>
                {
                    app.UseMiddleware<GlobalExceptionMiddleware>();
                    app.UseMiddleware<CorrelationIdMiddleware>();

                    app.Run(async ctx =>
                    {
                        var which = ctx.Request.Query["kind"].ToString();
                        Exception ex = which switch
                        {
                            "notfound" => NotFoundException.Entity("User", "123"),
                            "validation" => new ValidationException("name is required"),
                            "concurrency" => ConcurrencyException.VersionMismatch("User", 1, 2),
                            "unauthorized" => UnauthorizedException.MissingToken(),
                            "forbidden" => ForbiddenException.InsufficientPermissions("users:write"),
                            "conflict" => ConflictException.Duplicate("User", "email", "a@b.c"),
                            "businessrule" => BusinessRuleException.Violation("AGE_GTE_18", "must be at least 18"),
                            "domain" => DomainException.WithCode("INVALID_TENANT", "tenant X is not active"),
                            "internal" => new InvalidOperationException("sensitive detail"),
                            _ => new InvalidOperationException("unknown kind")
                        };
                        throw ex;
                    });
                });
            })
            .Build();
        _host.Start();
    }

    public HttpClient CreateClient() => _host.GetTestClient();

    public ValueTask DisposeAsync()
    {
        _host.Dispose();
        return ValueTask.CompletedTask;
    }
}
