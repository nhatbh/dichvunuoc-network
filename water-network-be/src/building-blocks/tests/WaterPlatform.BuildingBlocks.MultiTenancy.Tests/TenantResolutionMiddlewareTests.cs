using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Xunit;

namespace WaterPlatform.BuildingBlocks.MultiTenancy.Tests;

public class TenantResolutionMiddlewareTests
{
    private static readonly string[] CwaTenantId = ["tnt_cwa"];
    private static readonly string[] HawacoTenantId = ["tnt_hawaco"];
    private static readonly string[] ConflictingTenantIds = ["tnt_cwa", "tnt_other"];

    private static string OrganizationClaim(
        string alias,
        string tenantId,
        string? organizationId = "org-001",
        bool nestedAttributes = false)
    {
        object organization = nestedAttributes
            ? new
            {
                id = organizationId,
                attributes = new Dictionary<string, string[]> { ["tenant_id"] = [tenantId] }
            }
            : new Dictionary<string, object?>
            {
                ["id"] = organizationId,
                ["tenant_id"] = new[] { tenantId }
            };

        return JsonSerializer.Serialize(new Dictionary<string, object> { [alias] = organization });
    }

    private static DefaultHttpContext ContextWithClaims(params Claim[] claims)
    {
        var claimList = claims.ToList();
        if (claimList.Any(claim => claim.Type == "organization")
            && claimList.All(claim => claim.Type != "scope"))
        {
            // Most tests exercise the Organization claim shape, so give them the
            // canonical alias-selected scope by default. Scope rejection has its
            // own explicit tests below.
            claimList.Add(new Claim(
                "scope",
                $"openid organization:{FirstOrganizationAliasOrDefault(claimList, "cwa")}"));
        }

        var context = new DefaultHttpContext();
        context.User = new ClaimsPrincipal(new ClaimsIdentity(claimList, authenticationType: "test"));
        return context;
    }

    private static string FirstOrganizationAliasOrDefault(IEnumerable<Claim> claims, string fallback)
    {
        try
        {
            var value = claims.First(claim => claim.Type == "organization").Value;
            using var outer = JsonDocument.Parse(value);
            var root = outer.RootElement;
            JsonDocument? inner = null;
            try
            {
                if (root.ValueKind == JsonValueKind.String)
                {
                    inner = JsonDocument.Parse(root.GetString() ?? "");
                    root = inner.RootElement;
                }

                return root.ValueKind == JsonValueKind.Object
                    ? root.EnumerateObject().FirstOrDefault().Name ?? fallback
                    : fallback;
            }
            finally
            {
                inner?.Dispose();
            }
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            return fallback;
        }
    }

    private static async Task<MiddlewareResult> RunMiddleware(
        HttpContext httpContext,
        TenantOptions options,
        TenantContextAccessor? accessor = null)
    {
        accessor ??= new TenantContextAccessor();
        TenantContext? captured = null;
        var nextCalled = false;
        var middleware = new TenantResolutionMiddleware(
            _ =>
            {
                nextCalled = true;
                captured = accessor.Current;
                return Task.CompletedTask;
            },
            Options.Create(options));

        await middleware.InvokeAsync(httpContext, accessor);
        return new MiddlewareResult(captured, nextCalled, httpContext.Response.StatusCode);
    }

    [Fact]
    public async Task Resolves_Tenant_From_Selected_Organization_Claim()
    {
        var context = ContextWithClaims(
            new Claim("organization", OrganizationClaim("cwa", "tnt_cwa")),
            new Claim("branch_id", "branch-001"));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeTrue();
        result.Context.Should().NotBeNull();
        result.Context!.TenantId.Should().Be("tnt_cwa");
        result.Context.OrganizationId.Should().Be("org-001");
        result.Context.BranchId.Should().Be("branch-001");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("openid organization")]
    [InlineData("openid organization:*")]
    [InlineData("openid organization:hawaco")]
    [InlineData("openid organization:cwa organization:hawaco")]
    [InlineData("openid organization:cwa organization:cwa")]
    public async Task Organization_Claim_Requires_Exactly_One_Matching_Alias_Scope(string? scope)
    {
        var claims = new List<Claim>
        {
            new("organization", OrganizationClaim("cwa", "tnt_cwa"))
        };
        if (scope is not null)
            claims.Add(new Claim("scope", scope));

        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType: "test"))
        };

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
        result.Context.Should().BeNull();
    }

    [Fact]
    public async Task Undocumented_Nested_Attributes_Dialect_Is_Rejected()
    {
        var context = ContextWithClaims(new Claim(
            "organization",
            OrganizationClaim("cwa", "tnt_cwa", nestedAttributes: true)));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
        result.Context.Should().BeNull();
    }

    [Fact]
    public async Task Resolves_Tenant_From_Json_String_Wrapped_Organization_Claim()
    {
        var wrappedClaim = JsonSerializer.Serialize(OrganizationClaim("cwa", "tnt_cwa"));
        var context = ContextWithClaims(new Claim("organization", wrappedClaim));

        var result = await RunMiddleware(context, new TenantOptions());

        result.Context!.TenantId.Should().Be("tnt_cwa");
    }

    [Fact]
    public async Task Matching_Flat_Claim_Is_Accepted_Alongside_Organization()
    {
        var context = ContextWithClaims(
            new Claim("organization", OrganizationClaim("cwa", "tnt_cwa")),
            new Claim("tenant_id", "tnt_cwa"));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeTrue();
        result.Context!.TenantId.Should().Be("tnt_cwa");
    }

    [Fact]
    public async Task Mismatched_Flat_And_Organization_Tenants_Are_Rejected()
    {
        var context = ContextWithClaims(
            new Claim("organization", OrganizationClaim("cwa", "tnt_cwa")),
            new Claim("tenant_id", "cwa"));

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowFlatTenantClaimCompatibility = true
        });

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
        result.Context.Should().BeNull();
    }

    [Theory]
    [InlineData("cwa", "cwa")]
    [InlineData("cwa", "tnt_other")]
    [InlineData("CWA", "tnt_CWA")]
    [InlineData("cwa-1", "tnt_cwa-1")]
    [InlineData("tenant_alias_longer_than_twenty_eight", "tnt_tenant_alias_longer_than_twenty_eight")]
    public async Task Invalid_Alias_Or_Noncanonical_Organization_Tenant_Id_Is_Rejected(
        string alias,
        string tenantId)
    {
        var context = ContextWithClaims(new Claim(
            "organization",
            OrganizationClaim(alias, tenantId)));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
        result.Context.Should().BeNull();
    }

    [Fact]
    public async Task Flat_Only_Tenant_Is_Rejected_By_Default()
    {
        var context = ContextWithClaims(new Claim("tenant_id", "tnt_cwa"));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task Flat_Only_Tenant_Is_Accepted_When_Compatibility_Is_Explicitly_Enabled()
    {
        var context = ContextWithClaims(
            new Claim("tenant_id", "legacy-cwa"),
            new Claim("branch_id", "branch-001"));

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowFlatTenantClaimCompatibility = true
        });

        result.NextCalled.Should().BeTrue();
        result.Context.Should().Be(new TenantContext("legacy-cwa", null, "branch-001"));
    }

    [Fact]
    public async Task Multiple_Selected_Organizations_Are_Rejected()
    {
        var organization = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["cwa"] = new { id = "org-cwa", tenant_id = CwaTenantId },
            ["hawaco"] = new { id = "org-hawaco", tenant_id = HawacoTenantId }
        });
        var context = ContextWithClaims(new Claim("organization", organization));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task Multiple_Organization_Claims_Are_Rejected()
    {
        var context = ContextWithClaims(
            new Claim("organization", OrganizationClaim("cwa", "tnt_cwa")),
            new Claim("organization", OrganizationClaim("hawaco", "tnt_hawaco")));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
    }

    [Theory]
    [InlineData("not-json")]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"\":{\"tenant_id\":[\"tnt_cwa\"]}}")]
    public async Task Malformed_Or_Empty_Organization_Claim_Is_Rejected(string organization)
    {
        var context = ContextWithClaims(new Claim("organization", organization));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task Organization_Without_Tenant_Attribute_Does_Not_Fall_Back_To_Flat_Claim()
    {
        var organization = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["cwa"] = new { id = "org-cwa" }
        });
        var context = ContextWithClaims(
            new Claim("organization", organization),
            new Claim("tenant_id", "tnt_cwa"));

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowFlatTenantClaimCompatibility = true
        });

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task MultiValue_Organization_Tenant_Attribute_Is_Rejected()
    {
        var organization = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["cwa"] = new { id = "org-cwa", tenant_id = ConflictingTenantIds }
        });
        var context = ContextWithClaims(new Claim("organization", organization));

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task Duplicate_Flat_Tenant_Claims_Are_Rejected_In_Compatibility_Mode()
    {
        var context = ContextWithClaims(
            new Claim("tenant_id", "tnt_cwa"),
            new Claim("tenant_id", "tnt_other"));

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowFlatTenantClaimCompatibility = true
        });

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task Request_Without_Tenant_Claims_Continues_Without_Context()
    {
        var context = new DefaultHttpContext();

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeTrue();
        result.Context.Should().BeNull();
    }

    [Fact]
    public async Task Claims_From_Unauthenticated_Identity_Cannot_Establish_Tenant_Context()
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim("organization", OrganizationClaim("cwa", "tnt_cwa"))]))
        };

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeTrue();
        result.Context.Should().BeNull();
    }

    [Fact]
    public async Task Falls_Back_To_Header_Only_When_Explicitly_Allowed()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Tenant-Id"] = "tenant-from-header";

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowHeaderFallback = true
        });

        result.Context!.TenantId.Should().Be("tenant-from-header");
    }

    [Fact]
    public async Task Ignores_Header_When_Fallback_Is_Disabled()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Tenant-Id"] = "tenant-from-header";

        var result = await RunMiddleware(context, new TenantOptions());

        result.NextCalled.Should().BeTrue();
        result.Context.Should().BeNull();
    }

    [Fact]
    public async Task Organization_Claim_Wins_Over_Development_Header()
    {
        var context = ContextWithClaims(new Claim(
            "organization",
            OrganizationClaim("cwa", "tnt_cwa")));
        context.Request.Headers["X-Tenant-Id"] = "tenant-header";

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowHeaderFallback = true
        });

        result.Context!.TenantId.Should().Be("tnt_cwa");
    }

    [Fact]
    public async Task MultiValue_Header_Uses_First_Value_In_Development_Mode()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Tenant-Id"] = new StringValues(["tenant-a", "tenant-b"]);

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowHeaderFallback = true
        });

        result.Context!.TenantId.Should().Be("tenant-a");
    }

    [Fact]
    public async Task Whitespace_Flat_Claim_Is_Rejected()
    {
        var context = ContextWithClaims(new Claim("tenant_id", " "));

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowFlatTenantClaimCompatibility = true
        });

        result.NextCalled.Should().BeFalse();
        result.StatusCode.Should().Be(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task Whitespace_Header_Is_Treated_As_No_Tenant()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Tenant-Id"] = " ";

        var result = await RunMiddleware(context, new TenantOptions
        {
            AllowHeaderFallback = true
        });

        result.NextCalled.Should().BeTrue();
        result.Context.Should().BeNull();
    }

    [Fact]
    public async Task Accessor_Is_Cleared_After_Request()
    {
        var context = ContextWithClaims(new Claim(
            "organization",
            OrganizationClaim("cwa", "tnt_cwa")));
        var accessor = new TenantContextAccessor();

        await RunMiddleware(context, new TenantOptions(), accessor);

        accessor.Current.Should().BeNull();
    }

    [Fact]
    public async Task Concurrent_Requests_Have_Isolated_Tenant_Contexts()
    {
        var accessor = new TenantContextAccessor();
        var options = new TenantOptions();
        var first = ContextWithClaims(new Claim(
            "organization",
            OrganizationClaim("alpha", "tnt_alpha", "org-alpha")));
        var second = ContextWithClaims(new Claim(
            "organization",
            OrganizationClaim("beta", "tnt_beta", "org-beta")));

        TenantContext? firstContext = null;
        TenantContext? secondContext = null;
        var barrier = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var firstMiddleware = new TenantResolutionMiddleware(
            async _ =>
            {
                firstContext = accessor.Current;
                await barrier.Task;
            },
            Options.Create(options));

        var secondMiddleware = new TenantResolutionMiddleware(
            _ =>
            {
                secondContext = accessor.Current;
                barrier.SetResult();
                return Task.CompletedTask;
            },
            Options.Create(options));

        await Task.WhenAll(
            firstMiddleware.InvokeAsync(first, accessor),
            secondMiddleware.InvokeAsync(second, accessor));

        firstContext!.TenantId.Should().Be("tnt_alpha");
        secondContext!.TenantId.Should().Be("tnt_beta");
    }

    [Fact]
    public async Task Exception_In_Next_Propagates_And_Context_Is_Cleared()
    {
        var context = ContextWithClaims(new Claim(
            "organization",
            OrganizationClaim("cwa", "tnt_cwa")));
        var accessor = new TenantContextAccessor();
        var middleware = new TenantResolutionMiddleware(
            _ => throw new InvalidOperationException("boom"),
            Options.Create(new TenantOptions()));

        var act = async () => await middleware.InvokeAsync(context, accessor);

        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("boom");
        accessor.Current.Should().BeNull();
    }

    private sealed record MiddlewareResult(TenantContext? Context, bool NextCalled, int StatusCode);
}
