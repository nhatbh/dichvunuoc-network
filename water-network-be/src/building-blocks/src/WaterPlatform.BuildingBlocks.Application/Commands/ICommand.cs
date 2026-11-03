namespace WaterPlatform.BuildingBlocks.Application.Commands;

public interface ICommand<TResult>;
public interface ICommand : ICommand<Unit>;

public readonly record struct Unit
{
    public static readonly Unit Value;
}
