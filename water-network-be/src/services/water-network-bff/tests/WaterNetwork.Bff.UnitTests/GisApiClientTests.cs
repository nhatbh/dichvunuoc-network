using System.Net;
using System.Net.Http;
using System.Text.Json.Nodes;
using FluentAssertions;
using WaterNetwork.Bff.Api.Http;

namespace WaterNetwork.Bff.UnitTests;

public sealed class GisApiClientTests
{
    private static GisApiClient Build(StubHttpMessageHandler inner) =>
        new(new HttpClient(inner) { BaseAddress = new Uri("http://gis.test") });

    [Fact]
    public async Task Ok_200_Returns_Ok_With_Body()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.OK, "{\"id\":\"n1\"}"));

        var result = await client.GetDetailAsync("node", "n1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Ok);
        result.Value!["id"]!.GetValue<string>().Should().Be("n1");
    }

    [Fact]
    public async Task Node_Pipe_And_Device_Hit_Their_Routes()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        var client = Build(inner);

        await client.GetDetailAsync("node", "n1", CancellationToken.None);
        inner.LastRequest!.RequestUri!.AbsolutePath.Should().Be("/api/network/nodes/n1");

        await client.GetDetailAsync("pipe", "p1", CancellationToken.None);
        inner.LastRequest!.RequestUri!.AbsolutePath.Should().Be("/api/network/pipes/p1");

        await client.GetDetailAsync("device", "d1", CancellationToken.None);
        inner.LastRequest!.RequestUri!.AbsolutePath.Should().Be("/api/network/devices/d1");
    }

    [Fact]
    public async Task Unknown_Type_Throws_ArgumentOutOfRange()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.OK, "{}"));

        var act = () => client.GetDetailAsync("bogus", "x1", CancellationToken.None);

        await act.Should().ThrowAsync<ArgumentOutOfRangeException>();
    }

    [Fact]
    public async Task NotFound_404_Returns_NotFound()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.NotFound));

        var result = await client.GetDetailAsync("node", "missing", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.NotFound);
    }

    [Fact]
    public async Task ServerError_500_Returns_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.InternalServerError));

        var result = await client.GetDetailAsync("node", "n1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Unavailable);
    }

    [Fact]
    public async Task Network_Exception_Returns_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(_ => throw new HttpRequestException("boom")));

        var result = await client.GetDetailAsync("node", "n1", CancellationToken.None);

        result.Status.Should().Be(DownstreamStatus.Unavailable);
    }

    [Fact]
    public async Task Map_500_Marks_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.InternalServerError));

        var result = await client.GetMapAsync("1,2,3,4", "node", 100, CancellationToken.None);

        result.Unavailable.Should().BeTrue();
    }

    [Fact]
    public async Task Map_Passthrough_Forwards_Status_Body_And_Query()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "[{\"id\":\"n1\"}]");
        var client = Build(inner);

        var result = await client.GetMapAsync("1,2,3,4", "node,pipe", 50, CancellationToken.None);

        result.Unavailable.Should().BeFalse();
        result.StatusCode.Should().Be(200);
        result.Body!.AsArray().Should().HaveCount(1);
        inner.LastRequest!.RequestUri!.PathAndQuery.Should()
            .Be("/api/network/assets?bbox=1,2,3,4&types=node,pipe&limit=50");
    }

    [Fact]
    public async Task Map_Query_Values_Cannot_Inject_Additional_Parameters()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK, "{}");
        var client = Build(inner);

        await client.GetMapAsync("1,2,3,4&limit=999999", "node&types=pipe", 50, CancellationToken.None);

        inner.LastRequest!.RequestUri!.PathAndQuery.Should().Be(
            "/api/network/assets?bbox=1,2,3,4%26limit%3D999999&types=node%26types%3Dpipe&limit=50");
    }

    [Fact]
    public async Task Bootstrap_Passthrough_Uses_Canonical_Gis_Path()
    {
        var inner = new StubHttpMessageHandler(HttpStatusCode.OK,
            "{\"schemaVersion\":1,\"hasData\":false}");
        var client = Build(inner);

        var result = await client.GetBootstrapAsync(CancellationToken.None);

        result.Unavailable.Should().BeFalse();
        result.StatusCode.Should().Be(200);
        result.Body!["schemaVersion"]!.GetValue<int>().Should().Be(1);
        inner.LastRequest!.RequestUri!.AbsolutePath.Should().Be("/api/network/assets/bootstrap");
    }

    [Fact]
    public async Task Bootstrap_500_Marks_Downstream_Unavailable()
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.InternalServerError));

        var result = await client.GetBootstrapAsync(CancellationToken.None);

        result.Unavailable.Should().BeTrue();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-json")]
    public async Task Bootstrap_Invalid_Json_Marks_Downstream_Unavailable(string? body)
    {
        var client = Build(new StubHttpMessageHandler(HttpStatusCode.OK, body));

        var result = await client.GetBootstrapAsync(CancellationToken.None);

        result.Unavailable.Should().BeTrue();
        result.Body.Should().BeNull();
    }
}
