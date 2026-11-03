using FluentValidation;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Http.Resilience;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Services;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Infrastructure.Consumers;
using WaterNetwork.Design.Infrastructure.GisLookup;
using WaterNetwork.Design.Infrastructure.IntegrationEvents;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterNetwork.Design.Infrastructure.Repositories;
using WaterNetwork.Design.Infrastructure.Storage;
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
builder.Services.AddPlatformPersistence<DesignDbContext>(builder.Configuration, o => o.UseNetTopologySuite());
builder.Services.AddPlatformOutbox(builder.Configuration);
builder.Services.AddScoped<RevisionApprovedPublishConsumer>();
builder.Services.AddScoped<GisImportCompletedConsumer>();
builder.Services.AddPlatformEventBus(builder.Configuration, bus =>
{
    bus.AddConsumer<RevisionApprovedPublishConsumer>();
    bus.AddConsumer<GisImportCompletedConsumer>();
});
builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

builder.Services.AddHandlersFromAssembly(typeof(CreateDesignProjectCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(CreateDesignProjectCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);
builder.Services.AddScoped<IDesignProjectRepository, DesignProjectRepository>();
builder.Services.AddScoped<IDesignImportIngestor, DesignImportIngestor>();
builder.Services.AddScoped<IDesignProjectReadDao, DesignProjectReadDao>();
builder.Services.AddSingleton<IIntegrationEventMapper, DesignIntegrationEventMapper>();
builder.Services.Configure<FileStorageOptions>(builder.Configuration.GetSection(FileStorageOptions.SectionName));
builder.Services.AddScoped<IDesignDocumentRepository, DesignDocumentRepository>();
var fileStorageProvider = builder.Configuration.GetValue<string>(
    $"{FileStorageOptions.SectionName}:Provider") ?? "LocalDisk";
if (string.Equals(fileStorageProvider, "LocalDisk", StringComparison.OrdinalIgnoreCase))
{
    if (builder.Environment.IsProduction() && !migrationOnly)
    {
        throw new InvalidOperationException(
            "FileStorage:Provider=LocalDisk is not allowed in Production. "
            + "Configure the S3 object-storage provider before deploying Design.");
    }

    builder.Services.AddSingleton<IFileStoragePort, LocalDiskFileStorageAdapter>();
}
else if (string.Equals(fileStorageProvider, "S3", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddS3FileStorage(builder.Configuration);
}
else
{
    throw new InvalidOperationException(
        $"Unsupported FileStorage:Provider '{fileStorageProvider}'. "
        + "Expected LocalDisk (development only) or S3.");
}
builder.Services.AddScoped<IDesignRevisionRepository, DesignRevisionRepository>();
builder.Services.AddScoped<IDraftNetworkAssetRepository, DraftNetworkAssetRepository>();
builder.Services.AddScoped<IDesignRevisionReadDao, DesignRevisionReadDao>();
builder.Services.AddScoped<IDraftValidationService, DraftValidationService>();
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
builder.Services.AddScoped<IDesignImportResultStore, DesignImportResultStore>();
builder.Services.AddOutboxDomainEventTypesFromAssembly(
    typeof(WaterNetwork.Design.Domain.DomainEvents.DesignProjectCreated).Assembly);

var app = builder.Build();

if (migrationOnly)
{
    app.ApplyDatabaseMigrations(force: true);
    return;
}

// Set the endpoint-specific limit before minimal API JSON binding reads the body.
app.Use(async (context, next) =>
{
    if (context.Request.Path.Equals(new PathString("/api/design/imports")))
    {
        const long maxImportBytes = 100L * 1024 * 1024;
        if (context.Request.ContentLength > maxImportBytes)
        {
            context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            return;
        }
        var size = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (size is { IsReadOnly: false }) size.MaxRequestBodySize = maxImportBytes;
    }
    await next(context);
});
app.UsePlatformWebApi();
app.MapHealthChecks("/health");
app.MapEndpointModules(app.Services, typeof(Program).Assembly);

app.Run();

public partial class Program;
