using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignImportEndpointTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenant, bool write = true)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            DevJwtTokenFactory.CreateToken(new JwtOptions(), "import-user", tenant,
                permissions: write ? ["network-design:write"] : ["network-design:read"]));
        return client;
    }

    private static JsonObject Payload(string key, double latitude = 21.2) => new()
    {
        ["importKey"] = key, ["name"] = "Vinh Thinh CAD",
        ["provenance"] = new JsonObject { ["source"] = "drawing.dwg", ["version"] = 1 },
        ["assets"] = new JsonArray(new JsonObject
        {
            ["kind"] = "Node", ["assetCode"] = "VT-N-1", ["clientRef"] = "node-1",
            ["geometry"] = new JsonObject { ["type"] = "Point", ["coordinates"] = new JsonArray(new JsonArray(105.5, latitude)) },
            ["attributes"] = new JsonObject { ["nodeType"] = "Junction" }
        })
    };

    [Fact]
    public async Task Identical_retry_and_concurrent_retry_return_one_atomic_import()
    {
        using var factory = new DesignApiFactory(postgis);
        var tenant = "import-" + Guid.NewGuid().ToString("N");
        using var client = Client(factory, tenant);
        var key = Guid.NewGuid() + ":1";
        var responses = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => client.PostAsJsonAsync("/api/design/imports", Payload(key))));
        foreach (var response in responses) response.StatusCode.Should().Be(HttpStatusCode.OK);
        var bodies = await Task.WhenAll(responses.Select(r => r.Content.ReadFromJsonAsync<JsonObject>()));
        bodies.Select(b => b!["revisionId"]!.GetValue<string>()).Distinct().Should().ContainSingle();
        bodies[0]!["assetCount"]!.GetValue<int>().Should().Be(1);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DesignDbContext>();
        (await db.Set<DesignProjectPersistenceModel>().CountAsync(x => x.TenantId == tenant)).Should().Be(1);
        (await db.Set<DesignRevisionPersistenceModel>().CountAsync(x => x.TenantId == tenant)).Should().Be(1);
        (await db.Set<DraftNetworkAssetPersistenceModel>().CountAsync(x => x.TenantId == tenant)).Should().Be(1);
    }

    [Fact]
    public async Task Same_key_changed_payload_conflicts_but_other_tenant_is_independent()
    {
        using var factory = new DesignApiFactory(postgis);
        using var a = Client(factory, "import-a-" + Guid.NewGuid().ToString("N"));
        using var b = Client(factory, "import-b-" + Guid.NewGuid().ToString("N"));
        var key = Guid.NewGuid() + ":1";
        var first = await a.PostAsJsonAsync("/api/design/imports", Payload(key));
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        (await a.PostAsJsonAsync("/api/design/imports", Payload(key, 21.3))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var other = await b.PostAsJsonAsync("/api/design/imports", Payload(key));
        other.StatusCode.Should().Be(HttpStatusCode.OK);
        (await other.Content.ReadFromJsonAsync<JsonObject>())!["projectId"]!.ToString()
            .Should().NotBe((await first.Content.ReadFromJsonAsync<JsonObject>())!["projectId"]!.ToString());
    }

    [Fact]
    public async Task Invalid_geometry_rolls_back_project_revision_and_receipt_then_valid_retry_succeeds()
    {
        using var factory = new DesignApiFactory(postgis);
        var tenant = "import-invalid-" + Guid.NewGuid().ToString("N");
        using var client = Client(factory, tenant);
        var key = Guid.NewGuid() + ":1";
        var response = await client.PostAsJsonAsync("/api/design/imports", Payload(key, 100));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DesignDbContext>();
            (await db.Set<DesignProjectPersistenceModel>().CountAsync(x => x.TenantId == tenant)).Should().Be(0);
            (await db.Set<DesignRevisionPersistenceModel>().CountAsync(x => x.TenantId == tenant)).Should().Be(0);
            (await db.Set<DraftNetworkAssetPersistenceModel>().CountAsync(x => x.TenantId == tenant)).Should().Be(0);
            (await db.Set<DesignImportReceiptPersistenceModel>().CountAsync(x => x.TenantId == tenant)).Should().Be(0);
            (await db.Database.SqlQuery<long>($"SELECT count(*) AS \"Value\" FROM outbox_entries WHERE \"TenantId\" = {tenant}")
                .SingleAsync()).Should().Be(0);
        }
        (await client.PostAsJsonAsync("/api/design/imports", Payload(key))).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Requires_write_permission_and_rejects_non_object_provenance()
    {
        using var factory = new DesignApiFactory(postgis);
        using var readOnly = Client(factory, "import-perm", false);
        (await readOnly.PostAsJsonAsync("/api/design/imports", Payload("job:1"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using var writer = Client(factory, "import-perm");
        var body = Payload("job:1");
        body["provenance"] = "not an object";
        (await writer.PostAsJsonAsync("/api/design/imports", body)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
