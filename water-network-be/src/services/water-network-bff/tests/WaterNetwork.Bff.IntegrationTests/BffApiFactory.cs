using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;

namespace WaterNetwork.Bff.IntegrationTests;

public sealed class BffApiFactory : WebApplicationFactory<Program>
{
    public string? DesignBaseUrl { get; set; }
    public string? ImportBaseUrl { get; set; }
    public WireMockServer Gis { get; } = WireMockServer.Start();
    public WireMockServer Asset { get; } = WireMockServer.Start();
    public WireMockServer AppCatalog { get; } = WireMockServer.Start();

    public BffApiFactory()
    {
        AllowTenantApp();
    }

    public void AllowTenantApp() =>
        AppCatalog.Given(Request.Create()
                .WithPath("/api/platform/app-catalog/me/apps/ml-0/access")
                .UsingGet())
            .RespondWith(Response.Create().WithStatusCode(204));

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Downstream:Gis:BaseUrl"] = Gis.Url,
            ["Downstream:Design:BaseUrl"] = DesignBaseUrl,
            ["Downstream:Import:BaseUrl"] = ImportBaseUrl,
            ["Downstream:Asset:BaseUrl"] = Asset.Url,
            ["AppEntitlement:BaseUrl"] = AppCatalog.Url,
            ["AppEntitlement:AppCode"] = "ml-0",
            ["AppEntitlement:CacheTtlSeconds"] = "5",
            ["Jwt:Mode"] = "Mock"
        }));
        return base.CreateHost(builder);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Gis.Stop();
            Asset.Stop();
            AppCatalog.Stop();
        }
        base.Dispose(disposing);
    }
}
