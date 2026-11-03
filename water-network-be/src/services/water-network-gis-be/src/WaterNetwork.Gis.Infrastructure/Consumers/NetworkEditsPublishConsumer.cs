using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Application.Ports;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.Entities;
using WaterNetwork.Gis.Domain.Repositories;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterNetwork.Gis.Infrastructure.NetworkEditing;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Infrastructure.Events;

namespace WaterNetwork.Gis.Infrastructure.Consumers;

/// <summary>All graph edits, geometry history, receipts and outbox events commit together.</summary>
public sealed class NetworkEditsPublishConsumer(
    GisDbContext db, NetworkEditInspector inspector, INetworkNodeRepository nodes,
    INetworkPipeRepository pipes, INetworkDeviceRepository devices, IGeometryVersionStore geometries,
    IPipeLengthCalculator lengths, IGisImportBatchRepository batches, IInboxMessageStore inbox)
    : IdempotentEnvelopeConsumer(inbox)
{
    protected override string ConsumerName => "gis.network-edits-publish";
    protected override bool Subscribes(string eventType) => eventType == "design.network-edits.ready";
    protected override async Task HandleAsync(IntegrationEventEnvelope envelope,CancellationToken ct)
    {
        using var doc=JsonDocument.Parse(envelope.Payload);
        var batch=doc.RootElement.GetProperty("Data").Deserialize<DesignNetworkEditsReadyV1>()
            ?? throw new InvalidDataException("Missing network edits payload.");
        // Background outbox publishes have no ambient tenant. The internal payload carries it;
        // when an envelope tenant is present it must agree with that payload.
        if (string.IsNullOrWhiteSpace(batch.TenantId)) throw new InvalidDataException("Missing edit tenant.");
        if (envelope.TenantId is not null && batch.TenantId != envelope.TenantId) throw new InvalidDataException("Envelope tenant does not match edit tenant.");
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
            if(await db.Set<NetworkEditBatchPersistenceModel>().AnyAsync(x=>x.TenantId==batch.TenantId && x.RevisionId==batch.RevisionId,ct))
            { await transaction.CommitAsync(ct); return; }
            var receipt=new NetworkEditBatchPersistenceModel {RevisionId=batch.RevisionId,TenantId=batch.TenantId,Status="Applied",CompletedAt=DateTime.UtcNow};
            db.Add(receipt);
            var receipts=await db.GisImportLedger.AsNoTracking().Where(x=>x.TenantId==batch.TenantId && x.RevisionId==batch.RevisionId).ToListAsync(ct);
            if(receipts.Count>0)
            {
                if(receipts.Count!=batch.Operations.Count || batch.Operations.Any(op=>!receipts.Any(r=>r.DraftAssetId==op.Id)))
                    throw new InvalidDataException("Incomplete edit receipt: refusing a second application.");
                await transaction.CommitAsync(ct); return;
            }
            var inspection=await inspector.InspectAsync(batch.TenantId,batch.Operations,ct);
            if(inspection.Errors.Count>0)
            {
                // No canonical mutation has occurred. Publish a result for every rejected operation.
                receipt.Status="Rejected";
                var reason=string.Join("; ",inspection.Errors.Select(x=>x.Message).Distinct());
                await batches.SaveAsync(GisImportBatch.Completed(batch.RevisionId,batch.TenantId,[],
                    batch.Operations.Select(x=>new GisImportFailure(x.Id,x.After?.AssetCode??x.Before?.AssetCode??x.Id,reason)).ToArray()),ct);
                await transaction.CommitAsync(ct); return;
            }
            var refs=new Dictionary<string,string>(StringComparer.Ordinal);
            foreach(var op in inspection.Operations.Where(x=>x.TargetId!=null)) refs[op.Id]=op.TargetId!;
            string Resolve(string? key) => key is null ? throw new InvalidDataException("Missing reference.") : refs.GetValueOrDefault(key,key);
            var imported=new List<GisImportedAsset>();
            // Upserts first, so references can move off assets that will be deleted.
            var ordered=inspection.Operations.Where(x=>x.Action!="Delete").OrderBy(x=>x.Kind=="Node"?0:x.Kind=="Pipe"?1:2)
                .Concat(inspection.Operations.Where(x=>x.Action=="Delete").OrderBy(x=>x.Kind=="Device"?0:x.Kind=="Pipe"?1:2));
            foreach(var op in ordered)
            {
                var asset=op.After??op.Before!;
                string id;
                if(op.Action=="Delete")
                {
                    id=op.TargetId!;
                    if(op.Kind=="Node") { var a=await nodes.GetByIdAsync(batch.TenantId,id,ct) ?? throw new InvalidDataException("Node vanished."); a.SoftDelete(); await nodes.SaveAsync(a,ct); }
                    else if(op.Kind=="Pipe") { var a=await pipes.GetByIdAsync(batch.TenantId,id,ct) ?? throw new InvalidDataException("Pipe vanished."); a.SoftDelete(); await pipes.SaveAsync(a,ct); }
                    else { var a=await devices.GetByIdAsync(batch.TenantId,id,ct) ?? throw new InvalidDataException("Device vanished."); a.SoftDelete(); await devices.SaveAsync(a,ct); }
                }
                else
                {
                    var coords=asset.Geometry.Coordinates;
                    var points=coords.Select(p=>new GeoPoint(p[1],p[0])).ToArray();
                    var code=new AssetCode(asset.AssetCode);
                    if(op.Kind=="Node")
                    {
                        var type=Enum.Parse<NodeType>(asset.Attributes["nodeType"]);
                        var node=op.Action=="Add" ? NetworkNode.Register(batch.TenantId,code,type,points[0])
                            : await nodes.GetByIdAsync(batch.TenantId,op.TargetId!,ct) ?? throw new InvalidDataException("Node vanished.");
                        if(op.Action=="Update") node.Edit(code,type,points[0]);
                        await nodes.SaveAsync(node,ct); id=node.Id;
                    }
                    else if(op.Kind=="Pipe")
                    {
                        var from=Resolve(asset.FromRef);var to=Resolve(asset.ToRef);
                        var diameter=new Diameter(int.Parse(asset.Attributes["diameterMm"],CultureInfo.InvariantCulture));
                        var material=PipeMaterial.Parse(asset.Attributes["material"]);
                        var geometry=new PipeGeometry(points);
                        var length=await lengths.CalculateMetersAsync(points.Select(p=>(p.Latitude,p.Longitude)).ToArray(),ct);
                        var pipe=op.Action=="Add" ? NetworkPipe.Register(batch.TenantId,code,from,to,geometry,diameter,material,length,null)
                            : await pipes.GetByIdAsync(batch.TenantId,op.TargetId!,ct) ?? throw new InvalidDataException("Pipe vanished.");
                        if(op.Action=="Update") pipe.Edit(code,from,to,geometry,diameter,material,length);
                        await pipes.SaveAsync(pipe,ct); id=pipe.Id;
                    }
                    else
                    {
                        var type=DeviceType.Parse(asset.Attributes["deviceType"]);var hostId=Resolve(asset.HostRef);
                        var isPipe=await pipes.GetByIdAsync(batch.TenantId,hostId,ct)!=null;
                        var host=DeviceHost.For(type,isPipe?hostId:null,isPipe?null:hostId);
                        var device=op.Action=="Add" ? NetworkDevice.Install(batch.TenantId,code,type,host,points[0])
                            : await devices.GetByIdAsync(batch.TenantId,op.TargetId!,ct) ?? throw new InvalidDataException("Device vanished.");
                        if(op.Action=="Update") device.Edit(code,type,host,points[0]);
                        await devices.SaveAsync(device,ct);id=device.Id;
                    }
                    refs[op.Id]=id;
                    var geoJson=op.Kind=="Pipe" ? JsonSerializer.Serialize(new {type="LineString",coordinates=coords})
                        : JsonSerializer.Serialize(new {type="Point",coordinates=coords[0]});
                    await geometries.AppendAsync(GeometryVersion.Create(id,AssetKind.Parse(op.Kind),
                        await geometries.GetNextVersionAsync(id,ct),geoJson,batch.ApprovedBy,$"Design revision {batch.RevisionId}"),ct);
                }
                db.GisImportLedger.Add(new() { Id=Guid.CreateVersion7().ToString(),TenantId=batch.TenantId,RevisionId=batch.RevisionId,
                    DraftAssetId=op.Id,GisAssetId=id,Kind=op.Kind,AssetCode=asset.AssetCode,CreatedAt=DateTime.UtcNow });
                imported.Add(new(op.Id,id,op.Kind,asset.AssetCode));
            }
            await batches.SaveAsync(GisImportBatch.Completed(batch.RevisionId,batch.TenantId,imported,[]),ct);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        });
    }
}
