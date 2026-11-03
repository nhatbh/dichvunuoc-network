using System.Net;
using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace WaterPlatform.BuildingBlocks.WebApi.Tests;

/// <summary>
/// US-X-02: every unhandled exception MUST be translated into a unified
/// RFC 7807 ProblemDetails body with the correct status, title, code,
/// content-type, correlation ID, and trace ID.
/// </summary>
public class GlobalExceptionMiddlewareTests : IClassFixture<TestWebApplicationFactory>
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly TestWebApplicationFactory _factory;

    public GlobalExceptionMiddlewareTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
    }

    public static IEnumerable<object[]> ExceptionMappings() => new List<object[]>
    {
        new object[] { "notfound",       HttpStatusCode.NotFound,             "Resource not found",      "NOT_FOUND" },
        new object[] { "validation",     HttpStatusCode.BadRequest,           "Validation failed",       "VALIDATION_FAILED" },
        new object[] { "concurrency",    HttpStatusCode.Conflict,             "Concurrency conflict",    "CONCURRENCY_CONFLICT" },
        new object[] { "unauthorized",   HttpStatusCode.Unauthorized,         "Unauthorized",            "UNAUTHORIZED" },
        new object[] { "forbidden",      HttpStatusCode.Forbidden,            "Forbidden",               "FORBIDDEN" },
        new object[] { "conflict",       HttpStatusCode.Conflict,             "Conflict",                "CONFLICT" },
        new object[] { "businessrule",   HttpStatusCode.UnprocessableEntity,  "Business rule violation", "BUSINESS_RULE" },
        new object[] { "domain",         HttpStatusCode.BadRequest,           "Domain rule violation",   "DOMAIN_RULE" },
    };

    [Theory]
    [MemberData(nameof(ExceptionMappings))]
    public async Task Exception_Returns_ExpectedProblemDetails(
        string kind, HttpStatusCode expectedStatus, string expectedTitle, string expectedCode)
    {
        // Arrange
        using var client = _factory.CreateClient();
        var correlationId = $"test-corr-{Guid.NewGuid()}";

        // Act
        var response = await client.GetAsync($"/?kind={kind}");

        // Assert — status + content-type
        response.StatusCode.Should().Be(expectedStatus);
        response.Content.Headers.ContentType?.MediaType
            .Should().Be("application/problem+json");

        var body = await response.Content.ReadAsStringAsync();
        var problem = JsonSerializer.Deserialize<JsonElement>(body, JsonOptions);

        problem.GetProperty("status").GetInt32().Should().Be((int)expectedStatus);
        problem.GetProperty("title").GetString().Should().Be(expectedTitle);
        problem.GetProperty("type").GetString().Should().Be($"https://docs.water-platform/errors/{(int)expectedStatus}");
        problem.GetProperty("code").GetString().Should().Be(expectedCode);
        problem.GetProperty("instance").GetString().Should().Be("/");

        // Every 4xx/5xx MUST carry a correlation ID. traceId is present only
        // when there's an active Activity (TestServer doesn't create one).
        problem.GetProperty("correlationId").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task UnhandledException_DoesNotLeakExceptionMessage()
    {
        // Arrange
        using var client = _factory.CreateClient();

        // Act
        var response = await client.GetAsync("/?kind=internal");

        // Assert — 500 path is sanitized: the original exception message
        // MUST NOT appear in the response body.
        response.StatusCode.Should().Be(HttpStatusCode.InternalServerError);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().NotContain("sensitive detail");
        body.Should().Contain("An unexpected error occurred.");
        // No machine-readable code on 500
        var problem = JsonSerializer.Deserialize<JsonElement>(body, JsonOptions);
        problem.TryGetProperty("code", out _).Should().BeFalse();
    }

    [Fact]
    public async Task ResponseHeader_CarriesCorrelationId()
    {
        using var client = _factory.CreateClient();
        var response = await client.GetAsync("/?kind=notfound");
        response.Headers.TryGetValues("x-correlation-id", out var values).Should().BeTrue();
        values!.Should().ContainSingle().Which.Should().NotBeNullOrEmpty();
    }
}
