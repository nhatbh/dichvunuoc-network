namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public class UnauthorizedException : BaseException
{
    private UnauthorizedException(string message)
        : base("UNAUTHORIZED", message) { }

    public static UnauthorizedException MissingToken()
        => new("Authentication token is missing.");

    public static UnauthorizedException InvalidToken(string? reason = null)
        => new(reason is null ? "Authentication token is invalid." : $"Authentication token is invalid: {reason}");

    public static UnauthorizedException ExpiredToken()
        => new("Authentication token has expired.");
}
