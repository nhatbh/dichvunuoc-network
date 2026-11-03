using System.Net;
using FluentAssertions;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterNetwork.Incident.Infrastructure.GisLookup;

namespace WaterNetwork.Incident.UnitTests;

public sealed class HttpGisLookupAdapterTests
{
    [Theory]
    [InlineData(AssetRefKind.Node, "/api/network/nodes/node-1")]
    [InlineData(AssetRefKind.Pipe, "/api/network/pipes/node-1")]
    [InlineData(AssetRefKind.Device, "/api/network/devices/node-1")]
    public async Task Uses_The_Canonical_Detail_Endpoint(
        AssetRefKind kind,
        string expectedPath)
    {
        var handler = new RecordingHandler(HttpStatusCode.OK);
        var adapter = new HttpGisLookupAdapter(BuildClient(handler));

        var exists = await adapter.AssetRefExists(
            "tenant-1",
            kind,
            "node-1",
            CancellationToken.None);

        exists.Should().BeTrue();
        handler.PathAndQuery.Should().Be(expectedPath);
        handler.TenantId.Should().Be("tenant-1");
    }

    [Fact]
    public async Task Returns_False_Only_For_Not_Found()
    {
        var adapter = new HttpGisLookupAdapter(BuildClient(
            new RecordingHandler(HttpStatusCode.NotFound)));

        var exists = await adapter.AssetRefExists(
            "tenant-1",
            AssetRefKind.Pipe,
            "missing",
            CancellationToken.None);

        exists.Should().BeFalse();
    }

    [Fact]
    public async Task Throws_When_Gis_Is_Unavailable()
    {
        var adapter = new HttpGisLookupAdapter(BuildClient(
            new RecordingHandler(HttpStatusCode.ServiceUnavailable)));

        var act = () => adapter.AssetRefExists(
            "tenant-1",
            AssetRefKind.Pipe,
            "pipe-1",
            CancellationToken.None);

        await act.Should().ThrowAsync<HttpRequestException>();
    }

    private static HttpClient BuildClient(HttpMessageHandler handler) =>
        new(handler) { BaseAddress = new Uri("http://gis.test") };

    private sealed class RecordingHandler(HttpStatusCode statusCode) : HttpMessageHandler
    {
        public string? PathAndQuery { get; private set; }
        public string? TenantId { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            PathAndQuery = request.RequestUri?.PathAndQuery;
            TenantId = request.Headers.TryGetValues("X-Tenant-Id", out var values)
                ? values.SingleOrDefault()
                : null;
            return Task.FromResult(new HttpResponseMessage(statusCode));
        }
    }
}
