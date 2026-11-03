using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterPlatform.BuildingBlocks.Domain.Rules;

public interface IBusinessRule
{
    string Code { get; }
    string Message { get; }
    bool IsBroken();
}

public static class BusinessRuleChecker
{
    public static void Check(this IBusinessRule rule)
    {
        if (rule.IsBroken())
        {
            throw new BusinessRuleException(rule.Code, rule.Message);
        }
    }

    public static void CheckAll(params IBusinessRule[] rules)
    {
        foreach (var rule in rules)
        {
            rule.Check();
        }
    }
}
