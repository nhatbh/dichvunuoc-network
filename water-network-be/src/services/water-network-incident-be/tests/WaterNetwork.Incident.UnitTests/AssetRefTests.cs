using FluentAssertions;
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.UnitTests;

public sealed class AssetRefTests
{
    [Fact]
    public void Verified_Factory_Sets_Flag_True()
    {
        var r = AssetRef.Create("asset-1", AssetRefKind.Pipe, verified: true);
        r.AssetId.Should().Be("asset-1");
        r.Kind.Should().Be(AssetRefKind.Pipe);
        r.Verified.Should().BeTrue();
    }

    [Fact]
    public void Blank_AssetId_Throws()
    {
        var act = () => AssetRef.Create("  ", AssetRefKind.Node, verified: false);
        act.Should().Throw<ArgumentException>();
    }
}
