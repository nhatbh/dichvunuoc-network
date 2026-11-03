using FluentAssertions;
using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Gis.Infrastructure.NetworkEditing;
namespace WaterNetwork.Gis.UnitTests;
public sealed class NetworkEditValidationTests
{
    private static ReadyForGisAssetV1 Node(string id, double x = 105) => new(id,"Node",id,id,new("Point",[[x,21]]),new Dictionary<string,string>{{"nodeType","Junction"}},null,null,null);
    private static ReadyForGisAssetV1 Pipe() => new("p","Pipe","P1","p",new("LineString",[[105,21],[105.001,21]]),new Dictionary<string,string>{{"diameterMm","100"},{"material","HDPE"}},"n1","n2",null);
    private static Dictionary<string, NetworkEditAsset> State() => new() { ["n1"]=new(Node("n1"),2),["n2"]=new(Node("n2",105.001),0),["p"]=new(Pipe(),0) };
    [Fact] public void Null_Coordinate_Is_A_Structural_Error_Not_A_Savable_Draft()
    {
        var malformed = Node("a") with { Geometry = new("Point", [null!]) };
        var result = NetworkEditValidator.Inspect(State(), [new("a", "Add", "Node", null, null, malformed, null)]);
        result.Errors.Should().Contain(x => x.Code == "INVALID_OPERATION");
        result.Operations.Should().BeEmpty();
    }
    [Fact] public void Deleting_Connected_Node_Explains_The_Dependent_Pipe()
    {
        var r=NetworkEditValidator.Inspect(State(),[new("op","Delete","Node","n1",2,null,null)]);
        r.Errors.Should().Contain(x=>x.Code=="DEPENDENCY" && x.Message.Contains("P1"));
    }
    [Fact] public void Deleting_Pipe_And_Node_Together_Is_Valid()
    {
        var r=NetworkEditValidator.Inspect(State(),[new("a","Delete","Node","n1",2,null,null),new("b","Delete","Pipe","p",0,null,null)]);
        r.Errors.Should().BeEmpty();
    }
    [Fact] public void Wrong_Version_And_Unknown_Target_Are_Conflicts()
    {
        var r=NetworkEditValidator.Inspect(State(),[new("a","Delete","Node","n1",1,null,null),new("b","Delete","Node","foreign",0,null,null)]);
        r.Errors.Count(x=>x.Code=="TARGET_CONFLICT").Should().Be(2);
    }
    [Fact] public void Before_Comes_From_Server_Not_Client()
    {
        var r=NetworkEditValidator.Inspect(State(),[new("a","Update","Node","n1",2,Node("a"),Node("forged"))]);
        r.Operations[0].Before!.AssetCode.Should().Be("n1");
    }
    [Fact] public void Moving_Node_Requires_Updating_Connected_Pipe_Geometry()
    {
        var r=NetworkEditValidator.Inspect(State(),[new("a","Update","Node","n1",2,Node("a",106),null)]);
        r.Errors.Should().Contain(x=>x.Code=="ENDPOINT_POSITION");
    }
    [Fact] public void New_Pipe_Resolves_New_And_Existing_Nodes()
    {
        var pipe=Pipe() with { DraftAssetId="b", AssetCode="P2", FromRef="a", ToRef="n2" };
        var r=NetworkEditValidator.Inspect(State(),[new("a","Add","Node",null,null,Node("a"),null),new("b","Add","Pipe",null,null,pipe,null)]);
        r.Errors.Should().BeEmpty();
    }
}
