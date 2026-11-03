using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using WaterPlatform.BuildingBlocks.WebApi.Http;
using Xunit;

namespace WaterPlatform.BuildingBlocks.WebApi.Tests;

public sealed class DownstreamRequestContextHandlerTests
{
    [Fact]
    public async Task Forwards_Authentication_Tenant_And_Correlation_Context()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers.Authorization = "Bearer caller-token";
        context.Request.Headers["X-Tenant-Id"] = "tenant-from-request";
        context.Request.Headers["X-Correlation-Id"] = "correlation-1";
        var recorder = new RecordingHandler();

        using var client = BuildClient(context, recorder);
        await client.GetAsync("/lookup");

        recorder.Authorization.Should().Be("Bearer caller-token");
        recorder.TenantId.Should().Be("tenant-from-request");
        recorder.CorrelationId.Should().Be("correlation-1");
    }

    [Fact]
    public async Task Does_Not_Overwrite_A_Trusted_Tenant_Header_Set_By_The_Client()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Tenant-Id"] = "untrusted-inbound-tenant";
        var recorder = new RecordingHandler();

        using var client = BuildClient(context, recorder);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/lookup");
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", "resolved-tenant");
        await client.SendAsync(request);

        recorder.TenantId.Should().Be("resolved-tenant");
    }

    private static HttpClient BuildClient(HttpContext? context, HttpMessageHandler inner)
    {
        var accessor = new HttpContextAccessor { HttpContext = context };
        var handler = new DownstreamRequestContextHandler(accessor) { InnerHandler = inner };
        return new HttpClient(handler) { BaseAddress = new Uri("http://downstream.test") };
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public string? Authorization { get; private set; }
        public string? TenantId { get; private set; }
        public string? CorrelationId { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Authorization = request.Headers.Authorization?.ToString();
            TenantId = Header(request, "X-Tenant-Id");
            CorrelationId = Header(request, "X-Correlation-Id");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }

        private static string? Header(HttpRequestMessage request, string name) =>
            request.Headers.TryGetValues(name, out var values) ? values.SingleOrDefault() : null;
    }
}
