using FluentAssertions;
using WaterNetwork.Asset.Domain.Aggregates;
using WaterNetwork.Asset.Domain.DomainEvents;
using WaterNetwork.Asset.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Asset.UnitTests.Domain;

public class AssetTechnicalProfileTests
{
    private static NetworkAsset NewActiveAsset() =>
        NetworkAsset.RegisterFromGis("node-1", "tenant-1", AssetType.Node, "ND-001");

    [Fact]
    public void UpdateTechnicalProfile_Sets_Fields_And_Raises_Event()
    {
        var a = NewActiveAsset();
        a.ClearDomainEvents();
        a.UpdateTechnicalProfile("user-7", installationYear: 2019, manufacturer: "Acme",
            model: "V-200", attributes: new Dictionary<string, string?> { ["pressureRating"] = "PN16" });

        a.TechnicalProfile.Should().NotBeNull();
        a.TechnicalProfile!.InstallationYear.Should().Be(2019);
        a.TechnicalProfile.Manufacturer.Should().Be("Acme");
        a.TechnicalProfile.Model.Should().Be("V-200");
        a.TechnicalProfile.Attributes["pressureRating"].Should().Be("PN16");

        var evt = a.GetDomainEvents().OfType<AssetTechnicalProfileUpdated>().Single();
        evt.Data.InstallationYear.Should().Be(2019);
        evt.Data.Manufacturer.Should().Be("Acme");
    }

    [Fact]
    public void UpdateTechnicalProfile_Rejects_Implausible_InstallationYear()
    {
        var a = NewActiveAsset();
        a.Invoking(x => x.UpdateTechnicalProfile("user-7", installationYear: 1800, manufacturer: null, model: null,
                attributes: new Dictionary<string, string?>()))
            .Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("InvalidInstallationYear");
    }

    [Fact]
    public void UpdateTechnicalProfile_On_Decommissioned_Throws()
    {
        var a = NetworkAsset.Reconstitute("node-1", "tenant-1", AssetType.Node, "ND-001",
            AssetStatus.Decommissioned, 1, DateTime.UtcNow, DateTime.UtcNow, []);
        a.Invoking(x => x.UpdateTechnicalProfile("u", 2019, null, null, new Dictionary<string, string?>()))
            .Should().Throw<BusinessRuleException>().Which.Message.Should().Contain("AssetAlreadyDecommissioned");
    }
}
