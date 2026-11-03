using System.IdentityModel.Tokens.Jwt;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.IdentityModel.Tokens;
using WaterPlatform.BuildingBlocks.Security;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Security.Tests;

public class DevJwtTokenFactoryTests
{
    private static readonly JwtOptions DefaultOptions = new()
    {
        Issuer = "test-issuer",
        Audience = "test-audience",
        MockSigningKey = "test-signing-key-that-is-at-least-32-chars-long!"
    };

    private static TokenValidationParameters BuildValidationParameters(JwtOptions options) =>
        new()
        {
            ValidIssuer = options.Issuer,
            ValidAudience = options.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.MockSigningKey)),
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero
        };

    [Fact]
    public void Token_Parses_As_JwtSecurityToken()
    {
        var raw = DevJwtTokenFactory.CreateToken(DefaultOptions, "user-1", "tenant-001");

        var handler = new JwtSecurityTokenHandler();
        handler.CanReadToken(raw).Should().BeTrue();

        var parsed = handler.ReadJwtToken(raw);
        parsed.Should().BeOfType<JwtSecurityToken>();
    }

    [Fact]
    public void Token_Has_Correct_Issuer_And_Audience()
    {
        var raw = DevJwtTokenFactory.CreateToken(DefaultOptions, "user-1", "tenant-001");

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Issuer.Should().Be(DefaultOptions.Issuer);
        parsed.Audiences.Should().Contain(DefaultOptions.Audience);
    }

    [Fact]
    public void Token_Contains_Sub_And_TenantId_Claims()
    {
        var raw = DevJwtTokenFactory.CreateToken(DefaultOptions, "user-abc", "tenant-xyz");

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Subject.Should().Be("user-abc");
        parsed.Claims.Should().Contain(c => c.Type == "tenant_id" && c.Value == "tenant-xyz");
    }

    [Fact]
    public void Token_Contains_OrganizationId_When_Provided()
    {
        var raw = DevJwtTokenFactory.CreateToken(
            DefaultOptions, "user-1", "tenant-001", organizationId: "org-001");

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Claims.Should().Contain(c => c.Type == "organization_id" && c.Value == "org-001");
    }

    [Fact]
    public void Token_Omits_OrganizationId_When_Null()
    {
        var raw = DevJwtTokenFactory.CreateToken(
            DefaultOptions, "user-1", "tenant-001", organizationId: null);

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Claims.Should().NotContain(c => c.Type == "organization_id");
    }

    [Fact]
    public void Token_Contains_BranchId_When_Provided()
    {
        var raw = DevJwtTokenFactory.CreateToken(
            DefaultOptions, "user-1", "tenant-001",
            organizationId: "org-001", branchId: "branch-001");

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Claims.Should().Contain(c => c.Type == "branch_id" && c.Value == "branch-001");
    }

    [Fact]
    public void Token_Omits_BranchId_When_Null()
    {
        var raw = DevJwtTokenFactory.CreateToken(
            DefaultOptions, "user-1", "tenant-001", branchId: null);

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Claims.Should().NotContain(c => c.Type == "branch_id");
    }

    [Fact]
    public void Token_Contains_Multiple_Permission_Claims()
    {
        var raw = DevJwtTokenFactory.CreateToken(
            DefaultOptions, "user-1", "tenant-001",
            permissions: ["network-gis:read", "network-gis:write", "admin:manage"]);

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);
        var permClaims = parsed.Claims
            .Where(c => c.Type == "permission")
            .Select(c => c.Value)
            .ToList();

        permClaims.Should().Contain("network-gis:read");
        permClaims.Should().Contain("network-gis:write");
        permClaims.Should().Contain("admin:manage");
    }

    [Fact]
    public void Token_Contains_No_Permission_Claims_When_None_Passed()
    {
        var raw = DevJwtTokenFactory.CreateToken(DefaultOptions, "user-1", "tenant-001");

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Claims.Should().NotContain(c => c.Type == "permission");
    }

    [Fact]
    public void Token_Contains_Authorized_Party_When_Provided()
    {
        var raw = DevJwtTokenFactory.CreateTokenForAuthorizedParty(
            DefaultOptions,
            "user-1",
            "tenant-001",
            authorizedParty: "water-network-gis-fe");

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Claims.Should().ContainSingle(claim =>
            claim.Type == JwtRegisteredClaimNames.Azp
            && claim.Value == "water-network-gis-fe");
    }

    [Fact]
    public void Token_Test_Helper_Can_Emit_Multiple_Authorized_Parties()
    {
        var raw = DevJwtTokenFactory.CreateTokenWithAuthorizedParties(
            DefaultOptions,
            "user-1",
            "tenant-001",
            ["water-network-gis-fe", "another-app"]);

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);

        parsed.Claims.Where(claim => claim.Type == JwtRegisteredClaimNames.Azp)
            .Select(claim => claim.Value)
            .Should().Equal("water-network-gis-fe", "another-app");
    }

    [Fact]
    public void Organization_Token_Contains_Keycloak_Organization_Claim_And_No_Flat_Tenant_By_Default()
    {
        var raw = DevJwtTokenFactory.CreateOrganizationToken(
            DefaultOptions,
            subject: "user-1",
            organizationAlias: "cwa",
            tenantId: "tnt_cwa",
            organizationId: "org-cwa");

        var parsed = new JwtSecurityTokenHandler().ReadJwtToken(raw);
        var organization = parsed.Claims.Single(claim => claim.Type == "organization");
        parsed.Claims.Single(claim => claim.Type == "scope").Value
            .Should().Be("openid organization:cwa");
        using var document = JsonDocument.Parse(organization.Value);

        document.RootElement.GetProperty("cwa").GetProperty("id").GetString().Should().Be("org-cwa");
        document.RootElement.GetProperty("cwa").GetProperty("tenant_id")[0]
            .GetString().Should().Be("tnt_cwa");
        parsed.Claims.Should().NotContain(claim => claim.Type == "tenant_id");
    }

    [Fact]
    public void Token_Validates_Against_Same_Options_And_Principal_Has_Permission_Claims()
    {
        var raw = DevJwtTokenFactory.CreateToken(
            DefaultOptions, "user-1", "tenant-001",
            organizationId: "org-001",
            permissions: ["network-gis:read", "network-gis:write"]);

        var handler = new JwtSecurityTokenHandler();
        var principal = handler.ValidateToken(
            raw,
            BuildValidationParameters(DefaultOptions),
            out _);

        principal.Should().NotBeNull();
        principal.Claims.Should().Contain(c => c.Type == "permission" && c.Value == "network-gis:read");
        principal.Claims.Should().Contain(c => c.Type == "permission" && c.Value == "network-gis:write");
        principal.Claims.Should().Contain(c => c.Type == "tenant_id" && c.Value == "tenant-001");
        principal.Claims.Should().Contain(c => c.Type == "organization_id" && c.Value == "org-001");
    }

    [Fact]
    public void Token_Validation_Fails_With_Wrong_Key()
    {
        var raw = DevJwtTokenFactory.CreateToken(DefaultOptions, "user-1", "tenant-001");

        var wrongOptions = new JwtOptions
        {
            Issuer = DefaultOptions.Issuer,
            Audience = DefaultOptions.Audience,
            MockSigningKey = "completely-different-key-also-32-chars-long!!"
        };

        var handler = new JwtSecurityTokenHandler();
        var act = () => handler.ValidateToken(raw, BuildValidationParameters(wrongOptions), out _);

        act.Should().Throw<SecurityTokenSignatureKeyNotFoundException>();
    }
}
