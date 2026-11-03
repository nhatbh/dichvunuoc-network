using FluentValidation;
using Grpc.Core;
using Grpc.Net.Client.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Http.Resilience;
using WaterNetwork.Incident.Application.Commands;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Infrastructure.GisLookup;
using WaterNetwork.Incident.Infrastructure.IntegrationEvents;
using WaterNetwork.Incident.Infrastructure.Persistence;
using WaterNetwork.Incident.Infrastructure.Repositories;
using WaterNetwork.Incident.Infrastructure.Topology;
using WaterPlatform.BuildingBlocks.Application;
using WaterPlatform.BuildingBlocks.EventBus;
using WaterPlatform.BuildingBlocks.Infrastructure;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Observability;
using WaterPlatform.BuildingBlocks.WebApi.Bootstrap;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
using WaterPlatform.BuildingBlocks.WebApi.Http;

var migrationOnly = args.Contains("--migrate", StringComparer.OrdinalIgnoreCase);
var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddObservability(builder.Configuration);
builder.Services.AddPlatformCqrs();
builder.Services.AddPlatformCqrsBehaviors();
builder.Services.AddPlatformPersistence<IncidentDbContext>(builder.Configuration, o => o.UseNetTopologySuite());
builder.Services.AddPlatformOutbox(builder.Configuration);
builder.Services.AddPlatformEventBus(builder.Configuration);
builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

builder.Services.AddHandlersFromAssembly(typeof(ReportIncidentCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(ReportIncidentCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);

builder.Services.AddScoped<INetworkIncidentRepository, NetworkIncidentRepository>();
builder.Services.AddScoped<IIncidentReadDao, IncidentReadDao>();
builder.Services.AddSingleton<IIntegrationEventMapper, IncidentIntegrationEventMapper>();
builder.Services.AddOptions<GisLookupOptions>()
    .Bind(builder.Configuration.GetSection(GisLookupOptions.SectionName));

var gisLookupOptions = builder.Configuration
    .GetSection(GisLookupOptions.SectionName)
    .Get<GisLookupOptions>() ?? new GisLookupOptions();

if (string.Equals(gisLookupOptions.Provider, "Stub", StringComparison.OrdinalIgnoreCase))
{
    if (builder.Environment.IsProduction() && !migrationOnly)
        throw new InvalidOperationException("GisLookup:Provider=Stub is not allowed in Production.");

    builder.Services.AddSingleton<IGisLookupPort, StubGisLookupAdapter>();
}
else if (string.Equals(gisLookupOptions.Provider, "Http", StringComparison.OrdinalIgnoreCase))
{
    if (!Uri.TryCreate(gisLookupOptions.BaseUrl, UriKind.Absolute, out var gisBaseUri))
        throw new InvalidOperationException("GisLookup:BaseUrl must be an absolute URI for the Http provider.");

    builder.Services.AddHttpContextAccessor();
    builder.Services.AddTransient<DownstreamRequestContextHandler>();
    builder.Services.AddHttpClient<IGisLookupPort, HttpGisLookupAdapter>(client =>
        {
            client.BaseAddress = gisBaseUri;
        })
        .AddHttpMessageHandler<DownstreamRequestContextHandler>()
        .AddStandardResilienceHandler(options =>
        {
            options.Retry.MaxRetryAttempts = 2;
            options.AttemptTimeout.Timeout = TimeSpan.FromSeconds(2);
            options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(5);
        });
}
else
{
    throw new InvalidOperationException(
        $"Unsupported GisLookup:Provider '{gisLookupOptions.Provider}'. Expected Http or Stub.");
}

builder.Services.Configure<TopologyOptions>(builder.Configuration.GetSection(TopologyOptions.SectionName));
var topologyProvider = builder.Configuration.GetValue<string>($"{TopologyOptions.SectionName}:Provider") ?? "Grpc";
if (string.Equals(topologyProvider, "Stub", StringComparison.OrdinalIgnoreCase))
{
    if (builder.Environment.IsProduction() && !migrationOnly)
        throw new InvalidOperationException("Topology:Provider=Stub is not allowed in Production.");

    builder.Services.AddSingleton<ITopologyAnalysisPort, StubTopologyAnalysisAdapter>();
}
else
{
    var topologyBaseUrl = builder.Configuration.GetValue<string>($"{TopologyOptions.SectionName}:BaseUrl")
        ?? "http://water-network-topology-rs:50051";
    builder.Services.AddGrpcClient<Waternetwork.Topology.V1.TopologyService.TopologyServiceClient>(o =>
        {
            o.Address = new Uri(topologyBaseUrl);
        })
        .ConfigureChannel(ch => ch.ServiceConfig = new ServiceConfig
        {
            MethodConfigs =
            {
                new MethodConfig
                {
                    Names = { MethodName.Default },
                    RetryPolicy = new RetryPolicy
                    {
                        MaxAttempts = 3,
                        InitialBackoff = TimeSpan.FromMilliseconds(200),
                        MaxBackoff = TimeSpan.FromSeconds(2),
                        BackoffMultiplier = 2,
                        RetryableStatusCodes = { StatusCode.Unavailable, StatusCode.DeadlineExceeded }
                    }
                }
            }
        });
    builder.Services.AddScoped<ITopologyAnalysisPort, GrpcTopologyAnalysisAdapter>();
}

builder.Services.AddOutboxDomainEventTypesFromAssembly(
    typeof(WaterNetwork.Incident.Domain.DomainEvents.IncidentReported).Assembly);

var app = builder.Build();

if (migrationOnly)
{
    app.ApplyDatabaseMigrations(force: true);
    return;
}

app.UsePlatformWebApi();
app.MapHealthChecks("/health");
app.MapEndpointModules(app.Services, typeof(Program).Assembly);

app.Run();

public partial class Program;
