using System.Net;
using System.Net.Http;
using FluentAssertions;
using WaterNetwork.Bff.Api.Http;

namespace WaterNetwork.Bff.UnitTests;

public sealed class AssetApiClientTests
{
    private static AssetApiClient Build(StubHttpMessageHandler inner) =>
        new(new HttpClient(inner) { BaseAddress = new Uri("http://asset.test") });

    [Fact]
    public async Task Ok_200_Maps_Profile_Subset()
    {
        const string json = """
        {"id":"a1","tenantId":"t1","assetType":"Node","assetCode":"N-1","status":"Active",
         "createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z",
         "technicalProfile":{"installationYear":2020,"manufacturer":"Acme"},"lifecycleHistory":[]}
        """;
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.OK, json));

        var result = await client.GetProfileAsync("a1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Ok);
        result.Value!.Status.Should().Be("Active");
        result.Value.AssetCode.Should().Be("N-1");
        result.Value.TechnicalProfile!["manufacturer"]!.GetValue<string>().Should().Be("Acme");
    }

    [Fact]
    public async Task NotFound_404_Returns_NotFound()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.NotFound));

        var result = await client.GetProfileAsync("missing", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.NotFound);
    }

    [Fact]
    public async Task ServerError_And_Forbidden_Return_Unavailable()
    {
        (await Build(new StubHttpMessageHandler(HttpStatusCode.InternalServerError))
            .GetProfileAsync("a1", CancellationToken.None)).Status.Should().Be(DownstreamStatus.Unavailable);

        (await Build(new StubHttpMessageHandler(HttpStatusCode.Forbidden))
            .GetProfileAsync("a1", CancellationToken.None)).Status.Should().Be(DownstreamStatus.Unavailable);
    }

    [Fact]
    public async Task Network_Exception_Returns_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(_ => throw new HttpRequestException("boom")));

        var result = await client.GetProfileAsync("a1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Unavailable);
    }
}
