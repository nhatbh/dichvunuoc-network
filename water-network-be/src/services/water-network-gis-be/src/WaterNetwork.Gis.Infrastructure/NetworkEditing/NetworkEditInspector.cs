using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Application.Common;
using WaterNetwork.Gis.Infrastructure.Persistence;
namespace WaterNetwork.Gis.Infrastructure.NetworkEditing;
public sealed class NetworkEditInspector(GisDbContext db)
{
    public async Task<NetworkEditInspectionV1> InspectAsync(string tenantId, IReadOnlyList<NetworkEditOperationV1> operations, CancellationToken ct)
    {
        var state = await ReadStateAsync(tenantId,ct);
        var result=NetworkEditValidator.Inspect(state,operations);
        var codes=operations.Where(x=>x?.After!=null).Select(x=>x.After!.AssetCode).Distinct().ToArray();
        var reserved=new List<(string Id,string Code)>();
        reserved.AddRange((await db.NetworkNodes.IgnoreQueryFilters().AsNoTracking().Where(x=>x.TenantId==tenantId && codes.Contains(x.AssetCode)).Select(x=>new{x.Id,x.AssetCode}).ToListAsync(ct)).Select(x=>(x.Id,x.AssetCode)));
        reserved.AddRange((await db.NetworkPipes.IgnoreQueryFilters().AsNoTracking().Where(x=>x.TenantId==tenantId && codes.Contains(x.AssetCode)).Select(x=>new{x.Id,x.AssetCode}).ToListAsync(ct)).Select(x=>(x.Id,x.AssetCode)));
        reserved.AddRange((await db.NetworkDevices.IgnoreQueryFilters().AsNoTracking().Where(x=>x.TenantId==tenantId && codes.Contains(x.AssetCode)).Select(x=>new{x.Id,x.AssetCode}).ToListAsync(ct)).Select(x=>(x.Id,x.AssetCode)));
        var conflicts=operations.Where(x=>x?.After!=null && x.Action!="Delete" && reserved.Any(r=>r.Code==x.After!.AssetCode && r.Id!=x.TargetId))
            .Select(x=>new NetworkEditIssueV1("DUPLICATE_CODE",x.Id,"assetCode",$"Mã {x.After!.AssetCode} đang hoặc đã được sử dụng. Chọn mã mới, không đổi chéo mã giữa các tài sản."));
        return result with {Errors=result.Errors.Concat(conflicts).ToArray()};
    }
    public async Task<Dictionary<string,NetworkEditAsset>> ReadStateAsync(string tenantId,CancellationToken ct)
    {
        var state=new Dictionary<string,NetworkEditAsset>(StringComparer.Ordinal);
        foreach(var n in await db.NetworkNodes.AsNoTracking().Where(x=>x.TenantId==tenantId).ToListAsync(ct))
            state[n.Id]=new(new(n.Id,"Node",n.AssetCode,n.Id,new("Point",[[n.Location.X,n.Location.Y]]),Attributes(n.ComponentCode,n.Properties),null,null,null),n.Version);
        foreach(var p in await db.NetworkPipes.AsNoTracking().Where(x=>x.TenantId==tenantId).ToListAsync(ct))
            state[p.Id]=new(new(p.Id,"Pipe",p.AssetCode,p.Id,new("LineString",p.Geometry.Coordinates.Select(c=>(IReadOnlyList<double>)new[]{c.X,c.Y}).ToArray()),Attributes(p.ComponentCode,p.Properties,("diameterMm",p.DiameterMm.ToString(System.Globalization.CultureInfo.InvariantCulture)),("material",p.Material)),p.FromNodeId,p.ToNodeId,null),p.Version);
        foreach(var d in await db.NetworkDevices.AsNoTracking().Where(x=>x.TenantId==tenantId).ToListAsync(ct))
            state[d.Id]=new(new(d.Id,"Device",d.AssetCode,d.Id,new("Point",[[d.Location.X,d.Location.Y]]),Attributes(d.ComponentCode,d.Properties),null,null,d.HostPipeId??d.HostNodeId),d.Version);
        return state;
    }

    // Stored state in the same attribute shape the editor sends: componentCode, the catalog
    // properties, and the pipe's own columns (decision 0028).
    private static Dictionary<string,string> Attributes(string componentCode,string propertiesJson,params (string Key,string Value)[] extra)
    {
        var attributes=new Dictionary<string,string>(PropertiesJson.Read(propertiesJson),StringComparer.Ordinal){["componentCode"]=componentCode};
        foreach(var (key,value) in extra) attributes[key]=value;
        return attributes;
    }
}
