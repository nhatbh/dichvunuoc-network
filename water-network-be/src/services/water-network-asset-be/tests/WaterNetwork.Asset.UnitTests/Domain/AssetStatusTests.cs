using FluentAssertions;
using WaterNetwork.Asset.Domain.ValueObjects;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class AssetStatusTests
{
    [Fact]
    public void Defines_Full_Lifecycle_State_Set()
    {
        Enum.GetNames<AssetStatus>().Should().BeEquivalentTo(
            "Registered", "Active", "UnderMaintenance", "Suspended", "Decommissioned");
    }
}
