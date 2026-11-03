namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public class DomainException : BaseException
{
    public DomainException(string code, string message, object? details = null)
        : base(code, message, details) { }

    public static DomainException WithCode(string code, string message) => new(code, message);
}
