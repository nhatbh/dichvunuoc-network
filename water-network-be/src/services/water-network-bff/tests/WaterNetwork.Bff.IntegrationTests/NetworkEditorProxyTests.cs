using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using WaterPlatform.BuildingBlocks.Security;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
namespace WaterNetwork.Bff.IntegrationTests;
public sealed class NetworkEditorProxyTests
{
    [Theory]
    [InlineData("network-design:write",403)]
    [InlineData("network-design:read",403)]
    [InlineData("network-design:approve",200)]
    public async Task Only_Approvers_Can_Approve_And_Token_Is_Forwarded(string permission,int expected)
    {
        using var factory=new BffApiFactory();factory.DesignBaseUrl=factory.Gis.Url;
        factory.Gis.Given(Request.Create().WithPath("/api/design/revisions/r1/approve").UsingPost())
            .RespondWith(Response.Create().WithStatusCode(200).WithBody("{}"));
        using var client=factory.CreateClient();
        client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",DevJwtTokenFactory.CreateTokenForAuthorizedParty(new JwtOptions(),"u","tenant-1","water-network-gis-fe",permissions:[permission]));
        var response=await client.PostAsync("/api/gis/editor/revisions/r1/approve",new StringContent("{}"));
        ((int)response.StatusCode).Should().Be(expected);
        if(expected==200)factory.Gis.LogEntries.Should().ContainSingle().Subject.RequestMessage!.Headers!["Authorization"].Single().Should().StartWith("Bearer ");
        else factory.Gis.LogEntries.Should().BeEmpty();
    }
    [Fact] public async Task Unconfigured_Design_Fails_Closed()
    {
        using var factory=new BffApiFactory();using var client=factory.CreateClient();
        client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",DevJwtTokenFactory.CreateTokenForAuthorizedParty(new JwtOptions(),"u","tenant-1","water-network-gis-fe",permissions:["network-design:read"]));
        (await client.GetAsync("/api/gis/editor/revisions")).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        factory.Gis.LogEntries.Should().BeEmpty();
    }
}
