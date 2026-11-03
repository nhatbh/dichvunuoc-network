using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Gis.IntegrationTests;

public class RegisterPipeApiTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static HttpClient CreateAuthenticatedClient(GisApiFactory factory, params string[] permissions)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            new JwtOptions(), subject: "test-user", tenantId: "tenant-001",
            authorizedParty: "water-network-gis-fe", permissions: permissions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    // Seed 2 nodes and return their IDs
    private static async Task<(string fromNodeId, string toNodeId)> SeedTwoNodesAsync(HttpClient client)
    {
        var from = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-F-{Guid.NewGuid():N}"[..16],
            nodeType = "Junction",
            latitude = 10.762622,
            longitude = 106.660172
        });
        from.StatusCode.Should().Be(HttpStatusCode.Created);
        var fromBody = await from.Content.ReadFromJsonAsync<Dictionary<string, string>>();

        var to = await client.PostAsJsonAsync("/api/network/nodes", new
        {
            assetCode = $"ND-T-{Guid.NewGuid():N}"[..16],
            nodeType = "Junction",
            latitude = 10.763000,
            longitude = 106.661000
        });
        to.StatusCode.Should().Be(HttpStatusCode.Created);
        var toBody = await to.Content.ReadFromJsonAsync<Dictionary<string, string>>();

        return (fromBody!["id"], toBody!["id"]);
    }

    private static object ValidPipeBody(string assetCode, string fromNodeId, string toNodeId) => new
    {
        assetCode,
        fromNodeId,
        toNodeId,
        points = new[]
        {
            new { lat = 10.762622, lng = 106.660172 },
            new { lat = 10.763000, lng = 106.661000 }
        },
        diameterMm = 100.0,
        material = "HDPE"
    };

    [Fact]
    public async Task Register_Valid_Pipe_Returns_201_And_Get_Returns_All_Fields()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var (fromId, toId) = await SeedTwoNodesAsync(client);
        var code = $"PP-{Guid.NewGuid():N}"[..16];

        var response = await client.PostAsJsonAsync("/api/network/pipes", ValidPipeBody(code, fromId, toId));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().NotBeNull();
        var created = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        var id = created!["id"];
        id.Should().StartWith("pipe-");

        // Location header should point to the pipe
        response.Headers.Location!.ToString().Should().Contain(id);

        // GET should return all fields
        var detail = await client.GetAsync($"/api/network/pipes/{id}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await detail.Content.ReadFromJsonAsync<Dictionary<string, object>>();
        body.Should().NotBeNull();
        body!["id"].ToString().Should().Be(id);
        body["assetCode"].ToString().Should().Be(code);
        body["fromNodeId"].ToString().Should().Be(fromId);
        body["toNodeId"].ToString().Should().Be(toId);
        body["material"].ToString().Should().Be("HDPE");
        // lengthM should be computed from geometry (not zero)
        var lengthM = double.Parse(body["lengthM"].ToString()!, CultureInfo.InvariantCulture);
        lengthM.Should().BeGreaterThan(0);
        body["points"].ToString().Should().Contain("lat");
    }

    [Fact]
    public async Task Endpoint_Not_Found_Returns_422_With_BusinessRule_Code()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var (_, toId) = await SeedTwoNodesAsync(client);
        var code = $"PP-{Guid.NewGuid():N}"[..16];

        var response = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = code,
            fromNodeId = "node-does-not-exist-12345",
            toNodeId = toId,
            points = new[]
            {
                new { lat = 10.762622, lng = 106.660172 },
                new { lat = 10.763000, lng = 106.661000 }
            },
            diameterMm = 100.0,
            material = "HDPE"
        });

        // BusinessRuleException("NetworkPipe.EndpointNotFound") → GlobalExceptionMiddleware → 422
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var body = await response.Content.ReadAsStringAsync();
        // Middleware writes code:"BUSINESS_RULE" and the detail message references the missing node
        body.Should().Contain("BUSINESS_RULE");
        body.Should().Contain("node-does-not-exist-12345");
    }

    [Fact]
    public async Task Self_Loop_Returns_400_With_DomainRule_Code()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var (fromId, _) = await SeedTwoNodesAsync(client);
        var code = $"PP-{Guid.NewGuid():N}"[..16];

        var response = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = code,
            fromNodeId = fromId,
            toNodeId = fromId,   // same as from → self-loop
            points = new[]
            {
                new { lat = 10.762622, lng = 106.660172 },
                new { lat = 10.763000, lng = 106.661000 }
            },
            diameterMm = 100.0,
            material = "HDPE"
        });

        // DomainException("NetworkPipe.SelfLoop") → GlobalExceptionMiddleware → 400 BadRequest
        // (DomainException maps to 400; BusinessRuleException subclass maps to 422)
        // Request validator passes (fromNodeId and toNodeId are both non-empty strings);
        // the self-loop rule is a domain invariant checked inside the handler.
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("DOMAIN_RULE");
        body.Should().Contain("connect a node to itself");
    }

    [Fact]
    public async Task Bad_Geometry_Single_Point_Returns_400_With_ValidationFailed_Code()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var (fromId, toId) = await SeedTwoNodesAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId = fromId,
            toNodeId = toId,
            points = new[] { new { lat = 10.762622, lng = 106.660172 } }, // only 1 point
            diameterMm = 100.0,
            material = "HDPE"
        });

        // Request validator (RegisterPipeRequestValidator) rejects before handler
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Bad_Geometry_Invalid_Lat_Returns_400_With_ValidationFailed_Code()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var (fromId, toId) = await SeedTwoNodesAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId = fromId,
            toNodeId = toId,
            points = new[]
            {
                new { lat = 99.0, lng = 106.660172 }, // lat=99 is invalid
                new { lat = 10.763000, lng = 106.661000 }
            },
            diameterMm = 100.0,
            material = "HDPE"
        });

        // Request validator (RegisterPipeRequestValidator) rejects before handler
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task DiameterMm_Zero_Or_Negative_Returns_400_With_ValidationFailed_Code()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var (fromId, toId) = await SeedTwoNodesAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId = fromId,
            toNodeId = toId,
            points = new[]
            {
                new { lat = 10.762622, lng = 106.660172 },
                new { lat = 10.763000, lng = 106.661000 }
            },
            diameterMm = 0.0,   // must be > 0
            material = "HDPE"
        });

        // Request validator (RegisterPipeRequestValidator) rejects before handler
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Unknown_Material_Returns_400_With_ValidationFailed_Code()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var (fromId, toId) = await SeedTwoNodesAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId = fromId,
            toNodeId = toId,
            points = new[]
            {
                new { lat = 10.762622, lng = 106.660172 },
                new { lat = 10.763000, lng = 106.661000 }
            },
            diameterMm = 100.0,
            material = "Unobtainium"  // not in catalog
        });

        // RegisterPipeRequestValidator delegates to PipeMaterial.Parse — rejects at 400
        // with VALIDATION_FAILED (not DOMAIN_RULE), before the handler is ever reached.
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task DiameterMm_Fractional_Returns_400_With_ValidationFailed_Code()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write");

        var (fromId, toId) = await SeedTwoNodesAsync(client);

        var response = await client.PostAsJsonAsync("/api/network/pipes", new
        {
            assetCode = $"PP-{Guid.NewGuid():N}"[..16],
            fromNodeId = fromId,
            toNodeId = toId,
            points = new[]
            {
                new { lat = 10.762622, lng = 106.660172 },
                new { lat = 10.763000, lng = 106.661000 }
            },
            diameterMm = 100.7,  // fractional — silently rounds on persistence, rejected here
            material = "HDPE"
        });

        // Request validator rejects non-integral diameterMm to prevent silent banker's rounding
        // on the integer persistence column.
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Duplicate_AssetCode_Returns_409()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var (fromId, toId) = await SeedTwoNodesAsync(client);
        var code = $"PP-{Guid.NewGuid():N}"[..16];

        (await client.PostAsJsonAsync("/api/network/pipes", ValidPipeBody(code, fromId, toId)))
            .StatusCode.Should().Be(HttpStatusCode.Created);
        (await client.PostAsJsonAsync("/api/network/pipes", ValidPipeBody(code, fromId, toId)))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Successful_Post_Creates_Outbox_Message_With_Type_NetworkPipeRegistered()
    {
        await using var factory = new GisApiFactory(postgis);
        using var client = CreateAuthenticatedClient(factory, "network-gis:write", "network-gis:read");

        var (fromId, toId) = await SeedTwoNodesAsync(client);
        var code = $"PP-{Guid.NewGuid():N}"[..16];

        var response = await client.PostAsJsonAsync("/api/network/pipes", ValidPipeBody(code, fromId, toId));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await response.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        var pipeId = created!["id"];

        // Verify the outbox row was written
        using var scope = factory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        var outboxEntry = dbContext.OutboxEntries
            .FirstOrDefault(e => e.AggregateId == pipeId && e.EventType == "PipeRegistered");
        outboxEntry.Should().NotBeNull(
            "an outbox entry with EventType 'PipeRegistered' must be created for the pipe aggregate");
        Guid.Parse(outboxEntry!.Id).Version.Should().Be(7,
            "outbox entry ids must be time-ordered uuid v7");
    }
}
