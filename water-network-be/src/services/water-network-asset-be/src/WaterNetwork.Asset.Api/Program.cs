using FluentValidation;
using WaterNetwork.Asset.Application.Commands;
using WaterNetwork.Asset.Application.Ports;
using WaterNetwork.Asset.Domain.Repositories;
using WaterNetwork.Asset.Infrastructure.Consumers;
using WaterNetwork.Asset.Infrastructure.IntegrationEvents;
using WaterNetwork.Asset.Infrastructure.Persistence;
using WaterNetwork.Asset.Infrastructure.Repositories;
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
builder.Services.AddPlatformPersistence<AssetDbContext>(builder.Configuration);
builder.Services.AddPlatformOutbox(builder.Configuration);
builder.Services.AddPlatformRedisCache(builder.Configuration);
builder.Services.AddScoped<GisAssetRegistrationConsumer>();
builder.Services.AddPlatformEventBus(builder.Configuration, bus =>
{
    bus.AddConsumer<GisAssetRegistrationConsumer>();
});
builder.AddPlatformWebApi();
builder.AddDefaultHealthChecks();

builder.Services.AddHandlersFromAssembly(typeof(SuspendAssetCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(SuspendAssetCommand).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);

builder.Services.AddScoped<INetworkAssetRepository, NetworkAssetRepository>();
builder.Services.AddScoped<IAssetReadDao, AssetReadDao>();
builder.Services.AddSingleton<IIntegrationEventMapper, AssetIntegrationEventMapper>();
builder.Services.AddOutboxDomainEventTypesFromAssembly(
    typeof(WaterNetwork.Asset.Domain.DomainEvents.AssetRegistered).Assembly);

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
