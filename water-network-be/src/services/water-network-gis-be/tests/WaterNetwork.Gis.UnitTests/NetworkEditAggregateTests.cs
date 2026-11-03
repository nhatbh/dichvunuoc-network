using FluentAssertions;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.ValueObjects;
namespace WaterNetwork.Gis.UnitTests;
public sealed class NetworkEditAggregateTests
{
    [Fact] public void Pipe_Edit_Preserves_Id_And_Increments_Version_With_One_Event()
    {
        var pipe=NetworkPipe.Register("shw",new("P1"),"n1","n2",new([new(21,105),new(21,105.001)]),new(100),PipeMaterial.Parse("HDPE"),100,null);
        var id=pipe.Id; var version=pipe.Version; pipe.ClearDomainEvents();
        pipe.Edit(new("P1"),"n1","n3",new([new(21,105),new(21,105.002)]),new(150),PipeMaterial.Parse("PVC"),200);
        pipe.Id.Should().Be(id); pipe.Version.Should().Be(version+1); pipe.ToNodeId.Should().Be("n3");
        pipe.GetDomainEvents().Should().ContainSingle(x=>x.EventType=="NetworkAssetEdited");
    }
    [Fact] public void Node_Edit_Changes_Location_And_Type_Without_Recreating()
    {
        var n=NetworkNode.Register("shw",new("N1"),NodeType.Junction,new(21,105));var id=n.Id;
        n.ClearDomainEvents(); n.Edit(new("N1"),NodeType.Reservoir,new(21,106));
        n.Id.Should().Be(id);n.Location.Longitude.Should().Be(106);n.GetDomainEvents().Should().ContainSingle();
    }
}
