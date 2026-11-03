namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public class ValidationException : BaseException
{
    public IReadOnlyList<string> Errors { get; }

    public ValidationException(IReadOnlyList<string> errors)
        : base("VALIDATION_ERROR", "One or more validation errors occurred.", errors)
    {
        Errors = errors;
    }

    public ValidationException(string error)
        : this(new List<string> { error }.AsReadOnly()) { }
}
