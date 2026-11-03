using System.Net;
using System.Text;
using FluentAssertions;
using WaterNetwork.Design.Infrastructure.GisLookup;

namespace WaterNetwork.Design.UnitTests;

public sealed class HttpGisLookupAdapterTests
{
    [Fact]
    public async Task Sends_A_Tenant_Scoped_Encoded_Lookup_And_Parses_The_Result()
    {
        var handler = new RecordingHandler(
            HttpStatusCode.OK,
            "{\"exists\":true}");
        var adapter = new HttpGisLookupAdapter(BuildClient(handler));

        var exists = await adapter.AssetCodeExists(
            "tenant-1",
            "PIPE A/1",
            CancellationToken.None);

        exists.Should().BeTrue();
        handler.Method.Should().Be(HttpMethod.Get);
        handler.PathAndQuery.Should().Be("/api/network/assets/exists?assetCode=PIPE%20A%2F1");
        handler.TenantId.Should().Be("tenant-1");
    }

    [Fact]
    public async Task Throws_When_Gis_Is_Unavailable()
    {
        var adapter = new HttpGisLookupAdapter(BuildClient(
            new RecordingHandler(HttpStatusCode.ServiceUnavailable, "{}")));

        var act = () => adapter.AssetCodeExists(
            "tenant-1",
            "PIPE-1",
            CancellationToken.None);

        await act.Should().ThrowAsync<HttpRequestException>();
    }

    private static HttpClient BuildClient(HttpMessageHandler handler) =>
        new(handler) { BaseAddress = new Uri("http://gis.test") };

    private sealed class RecordingHandler(HttpStatusCode statusCode, string body) : HttpMessageHandler
    {
        public HttpMethod? Method { get; private set; }
        public string? PathAndQuery { get; private set; }
        public string? TenantId { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Method = request.Method;
            PathAndQuery = request.RequestUri?.PathAndQuery;
            TenantId = request.Headers.TryGetValues("X-Tenant-Id", out var values)
                ? values.SingleOrDefault()
                : null;

            return Task.FromResult(new HttpResponseMessage(statusCode)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            });
        }
    }
}
