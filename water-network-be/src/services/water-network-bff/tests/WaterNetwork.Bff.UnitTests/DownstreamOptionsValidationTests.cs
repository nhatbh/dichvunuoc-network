using FluentAssertions;
using WaterNetwork.Bff.Api.Configuration;

namespace WaterNetwork.Bff.UnitTests;

public sealed class DownstreamOptionsValidationTests
{
    [Theory]
    [InlineData("http://water-network-gis-be:8080", true)]
    [InlineData("https://api.example.test/base", true)]
    [InlineData("water-network-gis-be:8080", false)]
    [InlineData("ftp://api.example.test", false)]
    [InlineData("", false)]
    public void Accepts_Only_Absolute_Http_Urls(string value, bool expected)
    {
        DownstreamOptionsValidation.IsAbsoluteHttpUrl(value).Should().Be(expected);
    }
}
