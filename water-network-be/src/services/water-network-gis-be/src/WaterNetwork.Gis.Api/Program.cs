using FluentValidation;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Gis.Application.Commands;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterNetwork.Gis.Infrastructure.IntegrationEvents;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterNetwork.Gis.Infrastructure.Repositories;
using WaterPlatform.BuildingBlocks.Application;
using WaterPlatform.BuildingBlocks.EventBus;
using WaterPlatform.BuildingBlocks.Infrastructure;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;
using WaterPlatform.BuildingBlocks.Observability;
using WaterPlatform.BuildingBlocks.WebApi.Bootstrap;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.AddSerilogLogging();
builder.Services.AddObservability(builder.Configuration);
builder.Services.AddPlatformCqrs();
builder.Services.AddPlatformCqrsBehaviors();
builder.Services.AddPlatformPersistence<GisDbContext>(builder.Configuration, o => o.UseNetTopologySuite());
builder.Services.AddPlatformOutbox(builder.Configuration);
builder.Services.AddPlatformRedisCache(builder.Configuration);
builder.Services.AddScoped<AssetLifecycleProjectionConsumer>();
builder.Services.AddScoped<IGisImportBatchRepository, GisImportBatchRepository>();
builder.Services.AddScoped<DesignAssetImportConsumer>();
builder.Services.AddScoped<NetworkEditsPublishConsumer>();
builder.Services.AddPlatformEventBus(builder.Configuration, bus =>
{
    bus.AddConsumer<AssetLifecycleProjectionConsumer>();
    bus.AddConsumer<DesignAssetImportConsumer>();
    bus.AddConsumer<NetworkEditsPublishConsumer>();
});
builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

builder.Services.AddHandlersFromAssembly(typeof(RegisterNodeCommand).Assembly);
builder.Services.AddScoped<INetworkNodeRepository, NetworkNodeRepository>();
builder.Services.AddScoped<INetworkPipeRepository, NetworkPipeRepository>();
builder.Services.AddScoped<INetworkDeviceRepository, NetworkDeviceRepository>();
builder.Services.AddScoped<IGeometryVersionStore, GeometryVersionStore>();
builder.Services.AddScoped<IPipeLengthCalculator, PipeLengthCalculator>();
builder.Services.AddScoped<INodeReadDao, NodeReadDao>();
builder.Services.AddScoped<IPipeReadDao, PipeReadDao>();
builder.Services.AddScoped<IDeviceReadDao, DeviceReadDao>();
builder.Services.AddScoped<IGeometryVersionReadDao, GeometryVersionReadDao>();
builder.Services.AddScoped<IBboxAssetReadDao, BboxAssetReadDao>();
builder.Services.AddScoped<IAssetBootstrapReadDao, AssetBootstrapReadDao>();
builder.Services.AddScoped<IExportAssetReadDao, ExportAssetReadDao>();
builder.Services.AddScoped<IAssetStateProjectionStore, AssetStateProjectionStore>();
builder.Services.AddScoped<IGisImportLedgerStore, GisImportLedgerStore>();
builder.Services.AddScoped<IAssetTenantLookupDao, AssetTenantLookupDao>();
builder.Services.AddValidatorsFromAssembly(typeof(RegisterNodeCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);
builder.Services.AddSingleton<IIntegrationEventMapper, GisIntegrationEventMapper>();
builder.Services.AddOutboxDomainEventTypesFromAssembly(typeof(WaterNetwork.Gis.Domain.DomainEvents.NodeRegistered).Assembly);
builder.Services.Configure<WaterNetwork.Gis.Application.Configuration.BboxQueryOptions>(
    builder.Configuration.GetSection(WaterNetwork.Gis.Application.Configuration.BboxQueryOptions.SectionName));

builder.Services.AddScoped<WaterNetwork.Gis.Infrastructure.NetworkEditing.NetworkEditInspector>();

var app = builder.Build();

if (args.Contains("--migrate", StringComparer.OrdinalIgnoreCase))
{
    app.ApplyDatabaseMigrations(force: true);
    return;
}

app.UsePlatformWebApi();
app.MapHealthChecks("/health");
app.MapEndpointModules(app.Services, typeof(Program).Assembly);

app.Run();

public partial class Program;
