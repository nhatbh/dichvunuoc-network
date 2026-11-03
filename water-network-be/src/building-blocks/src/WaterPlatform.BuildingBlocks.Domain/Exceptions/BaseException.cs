namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public abstract class BaseException : Exception
{
    public string Code { get; }
    public object? Details { get; }

    protected BaseException(string code, string message, object? details = null)
        : base(message)
    {
        Code = code;
        Details = details;
    }
}
