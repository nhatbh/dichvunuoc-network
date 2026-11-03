using System.Net;
using FluentAssertions;
using WaterNetwork.Bff.Api.Http;

namespace WaterNetwork.Bff.UnitTests;

public sealed class TenantAppEntitlementClientTests
{
    [Fact]
    public async Task Only_authoritative_access_endpoint_no_content_grants_access()
    {
        var handler = new StubHttpMessageHandler(HttpStatusCode.NoContent);
        var result = await Build(handler).CheckAccessAsync("ml-0", CancellationToken.None);
        result.Should().Be(TenantAppAccessStatus.Allowed);
        handler.LastRequest!.RequestUri!.AbsolutePath.Should().Be(
            "/api/platform/app-catalog/me/apps/ml-0/access");
    }

    [Fact]
    public async Task Forbidden_is_a_definitive_denial() =>
        (await Build(new StubHttpMessageHandler(HttpStatusCode.Forbidden))
            .CheckAccessAsync("ml-0", CancellationToken.None)).Should().Be(TenantAppAccessStatus.Denied);

    [Theory]
    [InlineData(HttpStatusCode.OK)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task Unexpected_status_is_unavailable(HttpStatusCode status) =>
        (await Build(new StubHttpMessageHandler(status)).CheckAccessAsync("ml-0", CancellationToken.None))
            .Should().Be(TenantAppAccessStatus.Unavailable);

    [Fact]
    public async Task Network_failure_is_unavailable() =>
        (await Build(new StubHttpMessageHandler(_ => throw new HttpRequestException("offline")))
            .CheckAccessAsync("ml-0", CancellationToken.None)).Should().Be(TenantAppAccessStatus.Unavailable);

    [Fact]
    public async Task Request_cancellation_is_propagated()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var client = Build(new StubHttpMessageHandler(_ => throw new OperationCanceledException(cancellation.Token)));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.CheckAccessAsync("ml-0", cancellation.Token));
    }

    private static TenantAppEntitlementClient Build(HttpMessageHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://catalog.test"), MaxResponseContentBufferSize = 1024 * 1024 });
}
