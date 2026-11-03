using Microsoft.Extensions.Options;
using WaterNetwork.Bff.Api.Configuration;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;
namespace WaterNetwork.Bff.Api.Endpoints;

/// <summary>Fixed editor routes. Never accepts a caller-supplied upstream or permission.</summary>
public sealed class NetworkEditorEndpointModule : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group=app.MapGroup("/api/gis/editor");
        void Route(string method,string local,string upstream,string permission,bool gis=false) =>
            group.MapMethods(local,[method],(HttpContext ctx,IHttpClientFactory clients,IOptions<DownstreamOptions> options)=>
                Proxy(ctx,clients,options.Value,upstream,gis)).RequirePermission(permission);
        Route("GET","/assets","/api/network/editor-assets","network-gis:read",true);
        Route("GET","/revisions","/api/design/network-edits","network-design:read");
        Route("POST","/projects","/api/design/projects/","network-design:write");
        Route("POST","/projects/{id}/revisions","/api/design/projects/{id}/revisions","network-design:write");
        Route("GET","/revisions/{id}","/api/design/revisions/{id}/network-edits","network-design:read");
        Route("PUT","/revisions/{id}","/api/design/revisions/{id}/network-edits","network-design:write");
        foreach(var action in new[]{"validate","submit","approve","reject"})
            Route("POST","/revisions/{id}/"+action,"/api/design/revisions/{id}/"+action,
                action is "approve" or "reject" ? "network-design:approve" : "network-design:write");
        Route("GET","/revisions/{id}/publish-result","/api/design/revisions/{id}/publish-result","network-design:read");
    }
    private static async Task Proxy(HttpContext context,IHttpClientFactory clients,DownstreamOptions options,string path,bool gis)
    {
        var baseUrl=gis?options.Gis.BaseUrl:options.Design.BaseUrl;
        if(!DownstreamOptionsValidation.IsAbsoluteHttpUrl(baseUrl))
        { await Results.Problem("Network editor service is not configured.",statusCode:503).ExecuteAsync(context);return; }
        path=path.Replace("{id}",Uri.EscapeDataString(context.Request.RouteValues["id"]?.ToString()??""),StringComparison.Ordinal);
        using var request=new HttpRequestMessage(new HttpMethod(context.Request.Method),new Uri(new Uri(baseUrl),path));
        foreach(var name in new[]{"Authorization","X-Correlation-Id"})
            if(context.Request.Headers.TryGetValue(name,out var value))request.Headers.TryAddWithoutValidation(name,value.ToArray());
        if(context.Request.Method is "POST" or "PUT")
        {
            request.Content=new StreamContent(new BoundedUploadStream(context.Request.Body,10*1024*1024));
            request.Content.Headers.ContentType=new("application/json");
        }
        using var response=await clients.CreateClient("cad-import").SendAsync(request,HttpCompletionOption.ResponseHeadersRead,context.RequestAborted);
        context.Response.StatusCode=(int)response.StatusCode;
        context.Response.ContentType=response.Content.Headers.ContentType?.ToString()??"application/json";
        context.Response.Headers.CacheControl="no-store";
        await response.Content.CopyToAsync(context.Response.Body,context.RequestAborted);
    }
}
