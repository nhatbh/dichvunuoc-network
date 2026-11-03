namespace WaterPlatform.BuildingBlocks.Domain.Specifications;

public abstract class Specification<T> : ISpecification<T>
{
    public abstract bool IsSatisfiedBy(T entity);

    public Specification<T> And(ISpecification<T> other) => new AndSpecification<T>(this, other);
    public Specification<T> Or(ISpecification<T> other) => new OrSpecification<T>(this, other);
    public Specification<T> Not() => new NotSpecification<T>(this);
}
