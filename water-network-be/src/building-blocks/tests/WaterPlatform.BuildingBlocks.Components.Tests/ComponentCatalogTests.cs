using FluentAssertions;
using Xunit;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterPlatform.BuildingBlocks.Components.Tests;

public sealed class ComponentCatalogTests
{
    private static readonly IComponentCatalog Catalog = ComponentCatalog.Default;

    [Fact]
    public void Embedded_list_has_every_component_with_kind_host_and_functions()
    {
        Catalog.All.Should().HaveCountGreaterThanOrEqualTo(45);
        Catalog.Require("Pipe").Should().Match<ComponentDefinition>(d => d.Kind == ComponentKind.Pipe && d.Host == ComponentHosts.Line);
        Catalog.Require("Tee").Kind.Should().Be(ComponentKind.Node);
        var gate = Catalog.Require("GateValve");
        gate.Kind.Should().Be(ComponentKind.Device);
        gate.Host.Should().Be(ComponentHosts.Pipe);
        gate.Does(ComponentFunctions.Isolates).Should().BeTrue();
        Catalog.Require("CheckValve").Does(ComponentFunctions.Isolates).Should().BeFalse();
        Catalog.Require("Hydrant").Host.Should().Be(ComponentHosts.Node);
        Catalog.Require("Pump").Host.Should().Be(ComponentHosts.Pipe);
    }

    [Fact]
    public void Codes_are_case_insensitive_and_canonical()
        => Catalog.Find(" gatevalve ")!.Code.Should().Be("GateValve");

    [Fact]
    public void Unknown_code_and_wrong_kind_are_domain_errors()
    {
        var unknown = () => Catalog.Require("Teapot");
        unknown.Should().Throw<DomainException>().Which.Code.Should().Be("Component.Unknown");
        var wrongKind = () => Catalog.Require("GateValve", ComponentKind.Node);
        wrongKind.Should().Throw<DomainException>().Which.Code.Should().Be("Component.WrongKind");
    }

    [Fact]
    public void Properties_are_validated_against_the_catalog()
    {
        Catalog.ValidateProperties("Reducer", new Dictionary<string, string>
        {
            ["dn"] = "300", ["dn2"] = "200", ["material"] = "DuctileIron", ["elevationM"] = "12.5", ["year"] = "2024",
        }).Should().BeEmpty();
        var problems = Catalog.ValidateProperties("GateValve", new Dictionary<string, string>
        {
            ["dn"] = "abc", ["state"] = "half", ["colour"] = "red", ["year"] = "1700",
        });
        problems.Should().HaveCount(4);
        Catalog.ValidateProperties("PRV", new Dictionary<string, string> { ["setpoint"] = "35", ["state"] = "open" })
            .Should().BeEmpty();
    }

    [Fact]
    public void Attribute_bags_keep_declared_properties_and_reject_foreign_ones()
    {
        var catalog = ComponentCatalog.Default;
        var attrs = new Dictionary<string, string> { ["componentCode"] = "GateValve", ["source"] = "cad", ["state"] = "closed", ["dn"] = "150" };
        Assert.Equal(new Dictionary<string, string> { ["state"] = "closed", ["dn"] = "150" }, catalog.PropertiesIn("GateValve", attrs));
        Assert.Empty(catalog.ValidateAttributes("GateValve", attrs));

        var foreign = catalog.ValidateAttributes("GateValve", new Dictionary<string, string> { ["setpoint"] = "30" });
        Assert.Contains(foreign, p => p.Contains("setpoint", StringComparison.Ordinal));

        var pipe = new Dictionary<string, string> { ["diameterMm"] = "200", ["material"] = "HDPE", ["year"] = "1999" };
        Assert.Empty(catalog.ValidateAttributes("Pipe", pipe));
        Assert.Equal(["year"], catalog.PropertiesIn("Pipe", pipe).Keys);
    }
}
