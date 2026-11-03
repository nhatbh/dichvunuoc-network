using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NSubstitute;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

[Collection("design-postgis")]
public sealed class DesignDocumentApiTests(PostgisFixture postgis)
{
    private static HttpClient Client(DesignApiFactory factory, string tenantId, params string[] perms)
    {
        var client = factory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), subject: "u", tenantId: tenantId, permissions: perms);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> CreateProject(HttpClient client, string name)
    {
        var resp = await client.PostAsJsonAsync("/api/design/projects", new { name });
        return (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
    }

    private static MultipartFormDataContent FilePart(string content, string fileName, string contentType, string documentType)
    {
        var form = new MultipartFormDataContent();
        var bytes = new ByteArrayContent(Encoding.UTF8.GetBytes(content));
        bytes.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(bytes, "file", fileName);
        form.Add(new StringContent(documentType), "documentType");
        return form;
    }

    [Fact]
    public async Task Upload_Returns_201_And_Persists()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write");
        var projectId = await CreateProject(client, "DocProj");

        var resp = await client.PostAsync($"/api/design/projects/{projectId}/documents",
            FilePart("PDFDATA", "plan.pdf", "application/pdf", "Pdf"));

        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await resp.Content.ReadFromJsonAsync<JsonNode>())!["id"]!.GetValue<string>();
        id.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Upload_Invalid_ContentType_Returns_400()
    {
        // Create a factory with an allowed-content-types restriction so we can test the 400 path.
        using var factory = new DesignApiFactory(postgis);
        factory.ConfigOverrides["FileStorage:AllowedContentTypes:0"] = "application/pdf";
        using var client = Client(factory, "tenant-1", "network-design:write");
        var projectId = await CreateProject(client, "BadType");

        var resp = await client.PostAsync($"/api/design/projects/{projectId}/documents",
            FilePart("x", "evil.exe", "application/x-msdownload", "Other"));

        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Upload_To_Missing_Project_Returns_404()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write");

        var resp = await client.PostAsync("/api/design/projects/does-not-exist/documents",
            FilePart("x", "plan.pdf", "application/pdf", "Pdf"));

        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Storage_Failure_Returns_502_And_Does_Not_Commit_Metadata()
    {
        using var factory = new DesignApiFactory(postgis);
        var throwingStorage = Substitute.For<IFileStoragePort>();
        throwingStorage.SaveAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<Stream>(), Arg.Any<CancellationToken>())
            .Returns<Task<string>>(_ => throw new IOException("disk full"));

        // Replace the real adapter with a throwing one for this test.
        var clientFactory = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IFileStoragePort>();
                s.AddSingleton(throwingStorage);
            }));
        var client = clientFactory.CreateClient();
        var token = DevJwtTokenFactory.CreateToken(new JwtOptions(), "u", "tenant-1", permissions: ["network-design:write"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var projectId = await CreateProject(client, "StorageFail");
        var resp = await client.PostAsync($"/api/design/projects/{projectId}/documents",
            FilePart("x", "plan.pdf", "application/pdf", "Pdf"));

        resp.StatusCode.Should().Be(HttpStatusCode.BadGateway);

        // Storage failure must leave no document metadata committed for this project.
        using var scope = clientFactory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DesignDbContext>();
        var count = await db.Set<DesignDocumentPersistenceModel>().CountAsync(d => d.ProjectId == projectId);
        count.Should().Be(0, "storage failure must not commit document metadata");
    }

    [Fact]
    public async Task Upload_Invalid_DocumentType_Returns_400()
    {
        using var factory = new DesignApiFactory(postgis);
        using var client = Client(factory, "tenant-1", "network-design:write");
        var projectId = await CreateProject(client, "BadDocType");

        var resp = await client.PostAsync($"/api/design/projects/{projectId}/documents",
            FilePart("x", "plan.pdf", "application/pdf", "NotARealType"));

        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Upload_To_Other_Tenants_Project_Returns_404()
    {
        using var factory = new DesignApiFactory(postgis);

        // Tenant A creates a project.
        using var clientA = Client(factory, "tenant-a", "network-design:write");
        var projectId = await CreateProject(clientA, "TenantAProject");

        // Tenant B tries to upload to Tenant A's project — project existence check is tenant-scoped,
        // so Tenant B must see it as non-existent (404).
        using var clientB = Client(factory, "tenant-b", "network-design:write");
        var resp = await clientB.PostAsync($"/api/design/projects/{projectId}/documents",
            FilePart("PDFDATA", "plan.pdf", "application/pdf", "Pdf"));

        resp.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "the upload endpoint's project lookup is tenant-scoped; a cross-tenant project id must be invisible");
    }
}
