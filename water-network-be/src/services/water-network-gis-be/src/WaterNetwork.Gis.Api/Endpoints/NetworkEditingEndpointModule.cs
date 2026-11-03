using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.NetworkEditing;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
namespace WaterNetwork.Gis.Api.Endpoints;
public sealed class NetworkEditingEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/network/edit-inspection",async (IReadOnlyList<NetworkEditOperationV1> operations,NetworkEditInspector inspector,ITenantContextAccessor tenants,CancellationToken ct)=>
        {
            var tenant=tenants.Current ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
            if(operations.Count>2000) return Results.BadRequest(new {message="Tối đa 2000 thay đổi."});
            return Results.Ok(await inspector.InspectAsync(tenant.TenantId,operations,ct));
        }).RequirePermission("network-gis:read");
        app.MapGet("/api/network/editor-assets",async (NetworkEditInspector inspector,ITenantContextAccessor tenants,CancellationToken ct)=>
        {
            var tenant=tenants.Current ?? throw UnauthorizedException.InvalidToken("Tenant context is required.");
            return Results.Ok(await inspector.ReadStateAsync(tenant.TenantId,ct));
        }).RequirePermission("network-gis:read");
    }
}
