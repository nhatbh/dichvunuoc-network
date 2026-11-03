namespace WaterPlatform.BuildingBlocks.Domain.Specifications;

public sealed class NotSpecification<T>(ISpecification<T> spec) : Specification<T>
{
    public override bool IsSatisfiedBy(T entity) => !spec.IsSatisfiedBy(entity);
}
