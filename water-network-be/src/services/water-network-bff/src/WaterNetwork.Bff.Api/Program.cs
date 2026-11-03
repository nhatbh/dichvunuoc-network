using Microsoft.Extensions.Options;
using WaterNetwork.Bff.Api;
using WaterNetwork.Bff.Api.Configuration;
using WaterNetwork.Bff.Api.Http;
using WaterPlatform.BuildingBlocks.Observability;
using WaterPlatform.BuildingBlocks.WebApi.Bootstrap;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddObservability(builder.Configuration);
builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

builder.Services.AddHttpContextAccessor();

builder.Services.AddOptions<DownstreamOptions>()
    .Bind(builder.Configuration.GetSection(DownstreamOptions.SectionName))
    .Validate(options => DownstreamOptionsValidation.IsAbsoluteHttpUrl(options.Gis.BaseUrl),
        "Downstream:Gis:BaseUrl must be an absolute HTTP(S) URL.")
    .Validate(options => DownstreamOptionsValidation.IsAbsoluteHttpUrl(options.Asset.BaseUrl),
        "Downstream:Asset:BaseUrl must be an absolute HTTP(S) URL.")
    .ValidateOnStart();
builder.Services.AddOptions<AppEntitlementOptions>()
    .Bind(builder.Configuration.GetSection(AppEntitlementOptions.SectionName))
    .Validate(options =>
        Uri.TryCreate(options.BaseUrl, UriKind.Absolute, out var uri)
        && uri.Scheme is "http" or "https",
        "AppEntitlement:BaseUrl must be an absolute HTTP(S) URL.")
    .Validate(options => !string.IsNullOrWhiteSpace(options.AppCode),
        "AppEntitlement:AppCode is required.")
    .Validate(options => options.CacheTtlSeconds is >= 1 and <= 5,
        "AppEntitlement:CacheTtlSeconds must be between 1 and 5 seconds.")
    .ValidateOnStart();
builder.Services.AddMemoryCache();
builder.Services.AddTransient<AuthForwardingHandler>();

builder.Services.AddHttpClient<ITenantAppEntitlementClient, TenantAppEntitlementClient>((sp, client) =>
    {
        var options = sp.GetRequiredService<IOptions<AppEntitlementOptions>>().Value;
        client.BaseAddress = new Uri(options.BaseUrl);
        client.Timeout = TimeSpan.FromSeconds(2);
        client.MaxResponseContentBufferSize = 1024 * 1024;
    })
    .AddHttpMessageHandler<AuthForwardingHandler>();

builder.Services.AddHttpClient<IGisApiClient, GisApiClient>((sp, client) =>
    {
        var options = sp.GetRequiredService<IOptions<DownstreamOptions>>().Value;
        client.BaseAddress = new Uri(options.Gis.BaseUrl);
    })
    .AddHttpMessageHandler<AuthForwardingHandler>()
    .AddStandardResilienceHandler(ResilienceConfig.Configure);

builder.Services.AddHttpClient<IAssetApiClient, AssetApiClient>((sp, client) =>
    {
        var options = sp.GetRequiredService<IOptions<DownstreamOptions>>().Value;
        client.BaseAddress = new Uri(options.Asset.BaseUrl);
    })
    .AddHttpMessageHandler<AuthForwardingHandler>()
    .AddStandardResilienceHandler(ResilienceConfig.Configure);

// The streaming import proxy deliberately has no retry/resilience handler.
builder.Services.AddHttpClient("cad-import", client => client.Timeout = Timeout.InfiniteTimeSpan)
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false });

var app = builder.Build();

app.UsePlatformWebApi();
app.UseMiddleware<TenantAppEntitlementMiddleware>();
app.MapHealthChecks("/health");
app.MapEndpointModules(app.Services, typeof(Program).Assembly);

app.Run();

public partial class Program;
