using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.Consumers;
using WaterNetwork.Gis.Infrastructure.NetworkEditing;
using WaterNetwork.Gis.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.EventBus.Integration;
using WaterPlatform.BuildingBlocks.Testing;
namespace WaterNetwork.Gis.IntegrationTests;
public class NetworkEditsPublishTests(PostgisFixture postgis) : IClassFixture<PostgisFixture>
{
    private static ReadyForGisAssetV1 Node(string id,string code,double x)=>new(id,"Node",code,id,new("Point",[[x,21]]),new Dictionary<string,string>{{"nodeType","Junction"}},null,null,null);
    private static IntegrationEventEnvelope Envelope(string tenant,string revision,IReadOnlyList<NetworkEditOperationV1> ops)=>new(
        Guid.NewGuid().ToString(),"design.network-edits.ready",1,DateTime.UtcNow,tenant,null,null,null,null,"water-network-design-be",
        JsonSerializer.Serialize(new {Data=new DesignNetworkEditsReadyV1(revision,tenant,"reviewer",ops)}));
    [Theory]
    [InlineData(null)]
    [InlineData("wrong-tenant")]
    public async Task Background_Envelope_Allows_Missing_Tenant_But_Rejects_Mismatch(string? envelopeTenant)
    {
        await using var factory = new GisApiFactory(postgis);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
        await db.Database.MigrateAsync();
        var tenant = Guid.NewGuid().ToString();
        var envelope = Envelope(tenant, "background" + tenant,
            [new("a", "Add", "Node", null, null, Node("a", "BG-N1", 105), null)]) with { TenantId = envelopeTenant };
        var consumer = scope.ServiceProvider.GetRequiredService<NetworkEditsPublishConsumer>();
        if (envelopeTenant is null) await consumer.HandleEnvelopeAsync(envelope, default);
        else await FluentActions.Awaiting(() => consumer.HandleEnvelopeAsync(envelope, default)).Should().ThrowAsync<InvalidDataException>();
        (await db.NetworkNodes.CountAsync(x => x.TenantId == tenant)).Should().Be(envelopeTenant is null ? 1 : 0);
    }
    [Fact] public async Task Add_Update_Delete_Keep_Ids_And_Redelivery_Does_Not_Repeat()
    {
        await using var factory=new GisApiFactory(postgis);
        using var scope=factory.Services.CreateScope();var sp=scope.ServiceProvider;
        var db=sp.GetRequiredService<GisDbContext>();await db.Database.MigrateAsync();
        var consumer=sp.GetRequiredService<NetworkEditsPublishConsumer>();
        var tenant=Guid.NewGuid().ToString();
        var initial=new NetworkEditOperationV1[]{new("a","Add","Node",null,null,Node("a","N1",105),null),new("b","Add","Node",null,null,Node("b","N2",105.001),null)};
        await consumer.HandleEnvelopeAsync(Envelope(tenant,"r1"+tenant,initial),default);
        var state=await sp.GetRequiredService<NetworkEditInspector>().ReadStateAsync(tenant,default);
        var id=state.Single(x=>x.Value.Asset.AssetCode=="N1").Key;
        var update=new NetworkEditOperationV1[]{new("u","Update","Node",id,state[id].Version,Node("u","N1",106),null)};
        await consumer.HandleEnvelopeAsync(Envelope(tenant,"r2"+tenant,update),default);
        await consumer.HandleEnvelopeAsync(Envelope(tenant,"r2"+tenant,update),default);
        db.ChangeTracker.Clear();
        var node=await db.NetworkNodes.SingleAsync(x=>x.Id==id);
        node.Location.X.Should().Be(106);node.Version.Should().Be(1);
        (await db.GeometryVersions.CountAsync(x=>x.AssetId==id)).Should().Be(2);
        await consumer.HandleEnvelopeAsync(Envelope(tenant,"r3"+tenant,[new("d","Delete","Node",id,1,null,null)]),default);
        db.ChangeTracker.Clear();
        (await db.NetworkNodes.AnyAsync(x=>x.Id==id)).Should().BeFalse();
        (await db.NetworkNodes.IgnoreQueryFilters().SingleAsync(x=>x.Id==id)).DeletedAt.Should().NotBeNull();
    }
    [Fact] public async Task A_Conflict_Rejects_The_Entire_Batch_Without_Creating_The_Valid_Node()
    {
        await using var factory=new GisApiFactory(postgis);
        using var scope=factory.Services.CreateScope();var sp=scope.ServiceProvider;
        var db=sp.GetRequiredService<GisDbContext>();await db.Database.MigrateAsync();
        var consumer=sp.GetRequiredService<NetworkEditsPublishConsumer>();var tenant=Guid.NewGuid().ToString();
        await consumer.HandleEnvelopeAsync(Envelope(tenant,"bad"+tenant,[new("a","Add","Node",null,null,Node("a","N1",105),null),new("b","Delete","Node","foreign",0,null,null)]),default);
        (await db.NetworkNodes.CountAsync(x=>x.TenantId==tenant)).Should().Be(0);
        var completion=await db.OutboxEntries.SingleAsync(x=>x.AggregateId=="bad"+tenant);
        using var json=JsonDocument.Parse(completion.Payload);
        json.RootElement.GetProperty("Data").GetProperty("Imported").GetArrayLength().Should().Be(0);
        json.RootElement.GetProperty("Data").GetProperty("Failed").GetArrayLength().Should().Be(2);
    }

    [Fact] public async Task Rejected_Batch_Remains_Rejected_On_Redelivery()
    {
        await using var factory=new GisApiFactory(postgis);
        using var scope=factory.Services.CreateScope();var sp=scope.ServiceProvider;
        var db=sp.GetRequiredService<GisDbContext>();await db.Database.MigrateAsync();
        var consumer=sp.GetRequiredService<NetworkEditsPublishConsumer>();var tenant=Guid.NewGuid().ToString();
        var revision="rejected"+tenant;
        var edits=new NetworkEditOperationV1[]{new("a","Add","Node",null,null,Node("a","INVALID CODE",105),null)};
        await consumer.HandleEnvelopeAsync(Envelope(tenant,revision,edits),default);
        await consumer.HandleEnvelopeAsync(Envelope(tenant,revision,[edits[0] with {After=Node("a","VALID",105)}]),default);
        (await db.NetworkNodes.CountAsync(x=>x.TenantId==tenant)).Should().Be(0);
        (await db.Set<NetworkEditBatchPersistenceModel>().SingleAsync(x=>x.TenantId==tenant)).Status.Should().Be("Rejected");
    }

    [Fact]
    public async Task Concurrent_Approved_Edits_Cannot_Overwrite_The_Same_Base_Version()
    {
        await using var factory = new GisApiFactory(postgis);
        var tenant = Guid.NewGuid().ToString();
        string id;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GisDbContext>();
            await db.Database.MigrateAsync();
            await scope.ServiceProvider.GetRequiredService<NetworkEditsPublishConsumer>().HandleEnvelopeAsync(
                Envelope(tenant, "seed" + tenant, [new("a", "Add", "Node", null, null, Node("a", "RACE-N1", 105), null)]), default);
            id = (await db.NetworkNodes.SingleAsync(x => x.TenantId == tenant)).Id;
        }
        async Task Deliver(string revision, double longitude)
        {
            var envelope = Envelope(tenant, revision, [new("u", "Update", "Node", id, 0, Node("u", "RACE-N1", longitude), null)]);
            for (var attempt = 0; ; attempt++)
            {
                using var scope = factory.Services.CreateScope();
                try { await scope.ServiceProvider.GetRequiredService<NetworkEditsPublishConsumer>().HandleEnvelopeAsync(envelope, default); return; }
                catch (Exception ex) when (attempt < 2 && SerializationFailure(ex)) { /* broker redelivery after serialization rollback */ }
            }
        }
        await Task.WhenAll(Deliver("left" + tenant, 106), Deliver("right" + tenant, 107));
        using var verify = factory.Services.CreateScope();
        var database = verify.ServiceProvider.GetRequiredService<GisDbContext>();
        (await database.NetworkNodes.SingleAsync(x => x.Id == id)).Version.Should().Be(1);
        var receipts = await database.Set<NetworkEditBatchPersistenceModel>().Where(x => x.TenantId == tenant && x.RevisionId != "seed" + tenant).ToListAsync();
        receipts.Count(x => x.Status == "Applied").Should().Be(1);
        receipts.Count(x => x.Status == "Rejected").Should().Be(1);
    }
    private static bool SerializationFailure(Exception? ex)
    {
        while (ex is not null)
        {
            if (ex is Npgsql.PostgresException { SqlState: "40001" or "40P01" }) return true;
            ex = ex.InnerException;
        }
        return false;
    }
}
