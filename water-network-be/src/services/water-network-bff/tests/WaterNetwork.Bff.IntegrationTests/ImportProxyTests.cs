using System.Net;
using System.Net.Http.Headers;
using System.Text;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class ImportProxyTests
{
    private static HttpClient Client(BffApiFactory factory, params string[] permissions)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            DevJwtTokenFactory.CreateTokenForAuthorizedParty(new JwtOptions(), "u", "tenant-1",
                "water-network-gis-fe", permissions: permissions));
        client.DefaultRequestHeaders.Add("X-Correlation-Id", "cad-correlation");
        return client;
    }

    [Fact]
    public async Task Unconfigured_import_returns_503_without_calling_legacy_source()
    {
        using var factory = new BffApiFactory();
        using var client = Client(factory, "network-design:read");
        (await client.GetAsync("/api/gis/imports")).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Multipart_body_and_context_are_forwarded_once_and_errors_preserved()
    {
        using var factory = new BffApiFactory();
        factory.ImportBaseUrl = factory.Gis.Url;
        factory.Gis.Given(Request.Create().WithPath("/api/gis/imports").UsingPost())
            .RespondWith(Response.Create().WithStatusCode(422).WithHeader("Content-Type", "application/problem+json")
                .WithBody("{\"detail\":\"coordinate reference required\"}"));
        using var client = Client(factory, "network-design:write");
        using var upload = new MultipartFormDataContent("cad-boundary");
        upload.Add(new ByteArrayContent(Encoding.ASCII.GetBytes("AC1032 CAD source")), "files", "network.dwg");
        var response = await client.PostAsync("/api/gis/imports", upload);
        ((int)response.StatusCode).Should().Be(422);
        (await response.Content.ReadAsStringAsync()).Should().Contain("coordinate reference required");
        var request = factory.Gis.LogEntries.Should().ContainSingle().Subject.RequestMessage!;
        request.Headers!["Authorization"].Single().Should().StartWith("Bearer ");
        request.Headers["X-Correlation-Id"].Single().Should().Be("cad-correlation");
        request.Body.Should().Contain("AC1032 CAD source");
    }

    [Fact]
    public async Task Export_preserves_binary_bytes_and_download_headers()
    {
        using var factory = new BffApiFactory();
        factory.ImportBaseUrl = factory.Gis.Url;
        var bytes = new byte[] { 0, 255, 80, 75, 3, 4 };
        factory.Gis.Given(Request.Create().WithPath("/api/gis/imports/job/export").UsingGet())
            .RespondWith(Response.Create().WithStatusCode(200).WithBody(bytes)
                .WithHeader("Content-Type", "application/octet-stream")
                .WithHeader("Content-Disposition", "attachment; filename=network.zip"));
        using var client = Client(factory, "network-design:read");
        var response = await client.GetAsync("/api/gis/imports/job/export?format=gpkg");
        (await response.Content.ReadAsByteArrayAsync()).Should().Equal(bytes);
        response.Content.Headers.ContentDisposition!.FileName.Should().Be("network.zip");
    }

    [Theory]
    [InlineData("network-design:read", "/api/gis/imports", 403)]
    [InlineData("network-design:write", "/api/gis/imports/job/publish", 403)]
    [InlineData("network-design:approve", "/api/gis/imports/job/publish", 202)]
    public async Task Mutations_and_publish_require_their_own_permission(string permission, string path, int expected)
    {
        using var factory = new BffApiFactory();
        factory.ImportBaseUrl = factory.Gis.Url;
        factory.Gis.Given(Request.Create().WithPath(path).UsingPost())
            .RespondWith(Response.Create().WithStatusCode(202));
        using var client = Client(factory, permission);
        ((int)(await client.PostAsync(path, new StringContent("{}"))).StatusCode).Should().Be(expected);
        if (expected == 403) factory.Gis.LogEntries.Should().BeEmpty();
    }

    [Fact]
    public async Task Upstream_503_on_mutation_is_not_retried()
    {
        using var factory = new BffApiFactory();
        factory.ImportBaseUrl = factory.Gis.Url;
        factory.Gis.Given(Request.Create().WithPath("/api/gis/imports/job/analyze").UsingPost())
            .RespondWith(Response.Create().WithStatusCode(503));
        using var client = Client(factory, "network-design:write");
        (await client.PostAsync("/api/gis/imports/job/analyze", new StringContent("{}"))).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        factory.Gis.LogEntries.Should().ContainSingle();
    }
    [Fact]
    public async Task Oversized_declared_upload_is_rejected_before_downstream()
    {
        using var factory = new BffApiFactory();
        factory.ImportBaseUrl = factory.Gis.Url;
        using var client = Client(factory, "network-design:write");
        using var body = new ByteArrayContent([1]);
        body.Headers.ContentLength = 100L * 1024 * 1024 + 1;
        (await client.PostAsync("/api/gis/imports", body)).StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        factory.Gis.LogEntries.Should().BeEmpty();
    }

}
