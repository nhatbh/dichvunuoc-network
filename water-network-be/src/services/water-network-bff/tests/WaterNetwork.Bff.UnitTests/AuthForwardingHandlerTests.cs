using System.Net;
using System.Net.Http;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using WaterNetwork.Bff.Api.Http;
using WaterPlatform.BuildingBlocks.Application.Context;

namespace WaterNetwork.Bff.UnitTests;

public sealed class AuthForwardingHandlerTests
{
    private static HttpClient BuildClient(HttpContext? context, StubHttpMessageHandler inner)
    {
        var accessor = new HttpContextAccessor { HttpContext = context };
        var handler = new AuthForwardingHandler(accessor) { InnerHandler = inner };
        return new HttpClient(handler) { BaseAddress = new Uri("http://downstream.test") };
    }

    [Fact]
    public async Task Forwards_Authorization_And_Tenant_Headers()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers.Authorization = "Bearer abc123";
        ctx.Request.Headers["X-Tenant-Id"] = "tenant-1";
        ctx.Request.Headers["X-Correlation-Id"] = "req-xyz";

        using var client = BuildClient(ctx, inner);
        await client.GetAsync("/anything");

        inner.LastRequest!.Headers.Authorization!.ToString().Should().Be("Bearer abc123");
        inner.LastRequest.Headers.GetValues("X-Tenant-Id").Should().ContainSingle().Which.Should().Be("tenant-1");
        inner.LastRequest.Headers.GetValues("X-Correlation-Id").Should().ContainSingle().Which.Should().Be("req-xyz");
    }

    [Fact]
    public async Task Does_Nothing_When_No_HttpContext()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        using var client = BuildClient(context: null, inner);

        var act = async () => await client.GetAsync("/anything");

        await act.Should().NotThrowAsync();
        inner.LastRequest!.Headers.Authorization.Should().BeNull();
        inner.LastRequest.Headers.TryGetValues("X-Tenant-Id", out _).Should().BeFalse();
        inner.LastRequest.Headers.TryGetValues("X-Correlation-Id", out _).Should().BeFalse();
    }

    [Fact]
    public async Task Forwards_Correlation_Id_Generated_By_Platform_Middleware()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        var ctx = new DefaultHttpContext();
        ctx.Items["RequestContext"] = new RequestContext("generated-correlation-id");

        using var client = BuildClient(ctx, inner);
        await client.GetAsync("/anything");

        inner.LastRequest!.Headers.GetValues("X-Correlation-Id")
            .Should().ContainSingle().Which.Should().Be("generated-correlation-id");
    }

    [Fact]
    public async Task Does_Not_Overwrite_Trusted_Context_Already_Set_By_Client()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["X-Tenant-Id"] = "untrusted-request-tenant";
        using var client = BuildClient(ctx, inner);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/anything");
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", "resolved-tenant");

        await client.SendAsync(request);

        inner.LastRequest!.Headers.GetValues("X-Tenant-Id")
            .Should().ContainSingle().Which.Should().Be("resolved-tenant");
    }
}
