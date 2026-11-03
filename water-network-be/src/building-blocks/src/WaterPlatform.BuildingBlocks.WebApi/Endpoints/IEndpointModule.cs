using Microsoft.AspNetCore.Routing;

namespace WaterPlatform.BuildingBlocks.WebApi.Endpoints;

public interface IEndpointModule
{
    void MapEndpoints(IEndpointRouteBuilder app);
}
