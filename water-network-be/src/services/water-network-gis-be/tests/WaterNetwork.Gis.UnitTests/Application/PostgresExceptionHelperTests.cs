using Microsoft.EntityFrameworkCore;
using Npgsql;
using WaterNetwork.Gis.Application.Common;
using Xunit;
using FluentAssertions;

namespace WaterNetwork.Gis.UnitTests.Application;

public class PostgresExceptionHelperTests
{
    private static PostgresException UniqueViolation() =>
        new("duplicate key value violates unique constraint", "ERROR", "ERROR", "23505");

    private static PostgresException OtherPgError() =>
        new("some other error", "ERROR", "ERROR", "23503"); // FK violation, not unique

    [Fact]
    public void IsUniqueViolation_True_When_23505_Directly()
    {
        PostgresExceptionHelper.IsUniqueViolation(UniqueViolation()).Should().BeTrue();
    }

    [Fact]
    public void IsUniqueViolation_True_When_23505_Nested_In_DbUpdateException()
    {
        var ex = new DbUpdateException("save failed", UniqueViolation());
        PostgresExceptionHelper.IsUniqueViolation(ex).Should().BeTrue();
    }

    [Fact]
    public void IsUniqueViolation_False_When_Different_SqlState()
    {
        var ex = new DbUpdateException("save failed", OtherPgError());
        PostgresExceptionHelper.IsUniqueViolation(ex).Should().BeFalse();
    }

    [Fact]
    public void IsUniqueViolation_False_When_No_PostgresException_In_Chain()
    {
        var ex = new DbUpdateException("save failed", new InvalidOperationException("boom"));
        PostgresExceptionHelper.IsUniqueViolation(ex).Should().BeFalse();
    }

    [Fact]
    public void IsUniqueViolation_False_When_Null()
    {
        PostgresExceptionHelper.IsUniqueViolation(null).Should().BeFalse();
    }
}
