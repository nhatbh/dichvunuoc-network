using System.Globalization;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Gis.Infrastructure.NetworkEditing;

public sealed record NetworkEditAsset(ReadyForGisAssetV1 Asset, int Version);

/// <summary>Validates the resulting graph, not operation order. Coordinates are always EPSG:4326.</summary>
public static class NetworkEditValidator
{
    public static NetworkEditInspectionV1 Inspect(IReadOnlyDictionary<string, NetworkEditAsset> current,
        IReadOnlyList<NetworkEditOperationV1> operations)
    {
        var errors = new List<NetworkEditIssueV1>();
        void Error(string code, string id, string field, string text) => errors.Add(new(code,id,field,text));
        if (operations.Count > 2000) return new([], [new("INVALID_OPERATION","","operations","Tối đa 2000 thay đổi.")]);
        if (operations.Count == 0) Error("EMPTY_REVISION","","operations","Chưa có thay đổi để gửi duyệt.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var targets = new HashSet<string>(StringComparer.Ordinal);
        var edits = new List<NetworkEditOperationV1>();
        var final = current.ToDictionary(x=>x.Key,x=>x.Value.Asset,StringComparer.Ordinal);
        var affected = new Dictionary<string,string>(StringComparer.Ordinal);
        foreach (var input in operations)
        {
            if (input is null || string.IsNullOrWhiteSpace(input.Id) || input.Id.Length > 64 || !ids.Add(input.Id)
                || current.ContainsKey(input.Id) || input.Action is not ("Add" or "Update" or "Delete") || input.Kind is not ("Node" or "Pipe" or "Device"))
            { Error("INVALID_OPERATION",input?.Id ?? "","operations","Thay đổi không hợp lệ hoặc bị trùng mã."); continue; }
            var op = input with { Before = null };
            if (op.Action == "Add")
            {
                if (op.TargetId != null || op.ExpectedVersion != null)
                { Error("INVALID_OPERATION",op.Id,"targetId","Đối tượng mới không được có mã đích."); continue; }
            }
            else
            {
                if (op.TargetId is null || !targets.Add(op.TargetId) || !current.TryGetValue(op.TargetId, out var before)
                    || before.Asset.Kind != op.Kind || before.Version != op.ExpectedVersion)
                { Error("TARGET_CONFLICT",op.Id,"targetId","Đối tượng đã thay đổi, không còn tồn tại hoặc không thuộc mạng này. Tải lại trước khi sửa."); continue; }
                op = op with { Before = before.Asset };
                if (op.Action == "Update" && op.After?.AssetCode != before.Asset.AssetCode)
                    Error("ASSET_CODE_IMMUTABLE", op.Id, "assetCode", "Giữ nguyên mã tài sản đã công bố để đồng bộ hồ sơ quản lý tài sản.");
            }
            var key = op.TargetId ?? op.Id;
            affected[key] = op.Id;
            if (op.Action == "Delete") final.Remove(key);
            else if (op.After is not { } after || after.Kind != op.Kind || after.DraftAssetId != op.Id
                || after.Geometry is null || after.Geometry.Coordinates is null || after.Attributes is null
                || after.Geometry.Coordinates.Any(p => p is null)
                || after.Geometry.Coordinates.Count > 20000 || after.Attributes.Count > 40)
            { Error("INVALID_OPERATION",op.Id,"after","Nội dung thay đổi thiếu hoặc quá lớn."); continue; }
            else
            {
                op = op with { After = after with { ClientRef = op.Id } };
                final[key] = op.After!;
            }
            edits.Add(op);
        }
        var aliases = edits.Where(x=>x.Action!="Delete").ToDictionary(x=>x.Id,x=>x.TargetId??x.Id,StringComparer.Ordinal);
        string? Resolve(string? id) => id is null ? null : aliases.GetValueOrDefault(id,id);
        foreach (var pair in final)
        {
            var a = pair.Value;
            var from = Resolve(a.FromRef); var to = Resolve(a.ToRef); var host = Resolve(a.HostRef);
            var touched = affected.ContainsKey(pair.Key);
            var related = new[]{from,to,host}.Where(x=>x!=null && affected.ContainsKey(x)).Cast<string>().ToArray();
            if (!touched && related.Length == 0) continue;
            var opId = affected.GetValueOrDefault(pair.Key, related.Length > 0 ? affected[related[0]] : pair.Key);
            bool Exists(string? id,string kind) => id != null && final.TryGetValue(id,out var value) && value.Kind==kind;
            try
            {
                _ = new AssetCode(a.AssetCode);
                var coords = a.Geometry.Coordinates;
                if (coords.Any(p=>p is null || p.Count!=2 || p.Any(v=>!double.IsFinite(v)) || p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90)
                    || (a.Kind=="Pipe" ? a.Geometry.Type!="LineString" || coords.Count<2 : a.Geometry.Type!="Point" || coords.Count!=1))
                { Error("GEOMETRY",opId,"geometry",$"{a.AssetCode}: hình học hoặc tọa độ chưa hợp lệ."); continue; }
                if (a.Kind=="Node")
                {
                    if (!Enum.TryParse<NodeType>(a.Attributes.GetValueOrDefault("nodeType"),out var nodeType) || !Enum.IsDefined(nodeType))
                        Error("NODE_TYPE",opId,"nodeType",$"{a.AssetCode}: chọn loại nút.");
                }
                if (a.Kind=="Pipe")
                {
                    if (!int.TryParse(a.Attributes.GetValueOrDefault("diameterMm"), NumberStyles.Integer,CultureInfo.InvariantCulture,out var dn) || dn<=0)
                        Error("DIAMETER",opId,"diameterMm",$"{a.AssetCode}: đường kính phải là số nguyên dương.");
                    _ = PipeMaterial.Parse(a.Attributes.GetValueOrDefault("material") ?? "");
                    if (!Exists(from,"Node") || !Exists(to,"Node") || from==to)
                        Error("DEPENDENCY",opId,"endpoints",$"Ống {a.AssetCode} cần hai nút khác nhau còn tồn tại. Sửa liên kết hoặc xóa ống này cùng bản nháp.");
                    else if (final[from!].Geometry.Coordinates.Count != 1 || final[to!].Geometry.Coordinates.Count != 1
                        || !Near(coords[0], final[from!].Geometry.Coordinates[0]) || !Near(coords[^1],final[to!].Geometry.Coordinates[0]))
                        Error("ENDPOINT_POSITION",opId,"geometry",$"Ống {a.AssetCode}: đưa hai đầu ống về vị trí nút nối (sai số tối đa 1 m).");
                    if (coords.Zip(coords.Skip(1)).All(p=>p.First.SequenceEqual(p.Second)))
                        Error("GEOMETRY",opId,"geometry",$"Ống {a.AssetCode} không có chiều dài.");
                }
                if (a.Kind=="Device")
                {
                    var type = DeviceType.Parse(a.Attributes.GetValueOrDefault("deviceType") ?? "");
                    if (!Exists(host,"Pipe") && !Exists(host,"Node")) Error("DEPENDENCY",opId,"hostRef",$"Thiết bị {a.AssetCode} cần ống hoặc nút gắn còn tồn tại. Chuyển thiết bị hoặc xóa cùng bản nháp.");
                    else _ = DeviceHost.For(type, Exists(host,"Pipe")?host:null, Exists(host,"Node")?host:null);
                }
                if (touched && final.Any(x=>x.Key!=pair.Key && x.Value.AssetCode==a.AssetCode))
                    Error("DUPLICATE_CODE",opId,"assetCode",$"Mã {a.AssetCode} đã được sử dụng.");
            }
            catch (DomainException ex) { Error("INVALID_PROPERTIES",opId,"attributes",$"{a.AssetCode}: {ex.Message}"); }
        }
        return new(edits,errors);
    }

    private static bool Near(IReadOnlyList<double> a,IReadOnlyList<double> b)
    {
        if (a.Count!=2 || b.Count!=2) return false;
        var x=(a[0]-b[0])*111320*Math.Cos(a[1]*Math.PI/180); var y=(a[1]-b[1])*111320;
        return x*x+y*y<=1;
    }
}
