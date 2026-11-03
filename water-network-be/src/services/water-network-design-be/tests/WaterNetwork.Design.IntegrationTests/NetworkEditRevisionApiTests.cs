using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Contracts.Events;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;
namespace WaterNetwork.Design.IntegrationTests;
[Collection("design-postgis")]
public sealed class NetworkEditRevisionApiTests(PostgisFixture postgis)
{
    private sealed class Lookup : IGisLookupPort
    {
        public Task<bool> AssetCodeExists(string tenantId,string assetCode,CancellationToken ct=default)=>Task.FromResult(false);
        public Task<NetworkEditInspectionV1> InspectEdits(string tenantId,IReadOnlyList<NetworkEditOperationV1> operations,CancellationToken ct=default)=>Task.FromResult(new NetworkEditInspectionV1(operations,[]));
    }
    [Fact] public async Task Save_Reload_Validate_Submit_Locks_Save_And_Revalidate_And_Enforces_Tenant()
    {
        using var original=new DesignApiFactory(postgis);
        using var factory=original.WithWebHostBuilder(b=>b.ConfigureServices(s=>{s.RemoveAll<IGisLookupPort>();s.AddSingleton<IGisLookupPort,Lookup>();}));
        using var client=factory.CreateClient();
        string Token(string tenant,params string[] permissions)=>DevJwtTokenFactory.CreateToken(new JwtOptions(),subject:"editor",tenantId:tenant,permissions:permissions);
        client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",Token("shw","network-design:read","network-design:write"));
        var project=await client.PostAsJsonAsync("/api/design/projects",new {name="Editor test"});
        project.EnsureSuccessStatusCode();var projectId=(await project.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        var created=await client.PostAsync($"/api/design/projects/{projectId}/revisions",null);created.EnsureSuccessStatusCode();
        var id=(await created.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        var path=$"/api/design/revisions/{id}/network-edits";
        var initial=await client.GetFromJsonAsync<JsonNode>(path);var version=initial!["version"]!.GetValue<int>();
        var body=new {expectedVersion=version,operations=new[]{new NetworkEditOperationV1("new1","Add","Node",null,null,
            new("new1","Node","N-EDIT","new1",new("Point",[[105,21]]),new Dictionary<string,string>{{"nodeType","Junction"}},null,null,null),null)}};
        (await client.PutAsJsonAsync(path,body)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.PutAsJsonAsync(path,body)).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var reload=await client.GetFromJsonAsync<JsonNode>(path);
        reload!["operations"]!.AsArray().Count.Should().Be(1);
        (await client.PostAsync($"/api/design/revisions/{id}/validate",null)).EnsureSuccessStatusCode();
        (await client.PostAsync($"/api/design/revisions/{id}/submit",null)).EnsureSuccessStatusCode();
        (await client.PostAsync($"/api/design/revisions/{id}/validate",null)).IsSuccessStatusCode.Should().BeFalse();
        (await client.PutAsJsonAsync(path,new {expectedVersion=reload["version"]!.GetValue<int>(),body.operations})).IsSuccessStatusCode.Should().BeFalse();
        (await client.PostAsJsonAsync($"/api/design/revisions/{id}/approve",new {})).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",Token("other","network-design:read","network-design:write"));
        (await client.GetAsync(path)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.PutAsJsonAsync(path,body)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
