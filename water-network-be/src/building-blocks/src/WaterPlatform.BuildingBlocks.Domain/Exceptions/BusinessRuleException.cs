namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public class BusinessRuleException : DomainException
{
    public BusinessRuleException(string rule, string message, object? details = null)
        : base($"BUSINESS_RULE.{rule}", message, details) { }

    public static BusinessRuleException Violation(string rule, string message)
        => new(rule, message);
}
