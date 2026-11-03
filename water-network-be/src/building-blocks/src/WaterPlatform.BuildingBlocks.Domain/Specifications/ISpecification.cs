namespace WaterPlatform.BuildingBlocks.Domain.Specifications;

public interface ISpecification<T>
{
    bool IsSatisfiedBy(T entity);
}
