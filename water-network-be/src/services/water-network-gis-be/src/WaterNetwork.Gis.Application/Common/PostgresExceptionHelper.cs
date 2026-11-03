using Npgsql;

namespace WaterNetwork.Gis.Application.Common;

/// <summary>
/// Shared detection for PostgreSQL error conditions surfaced through EF Core's
/// <see cref="Microsoft.EntityFrameworkCore.DbUpdateException"/>. Command handlers use this to
/// translate a unique-constraint race into a domain <c>ConflictException</c> (HTTP 409).
/// </summary>
public static class PostgresExceptionHelper
{
    /// <summary>PostgreSQL SQLSTATE for unique_violation.</summary>
    private const string UniqueViolationSqlState = "23505";

    /// <summary>
    /// True when <paramref name="ex"/> (or any exception in its InnerException chain) is a
    /// <see cref="PostgresException"/> whose SqlState is unique_violation (23505).
    /// </summary>
    public static bool IsUniqueViolation(Exception? ex)
    {
        while (ex is not null)
        {
            if (ex is PostgresException pg)
                return pg.SqlState == UniqueViolationSqlState;
            ex = ex.InnerException;
        }
        return false;
    }
}
