namespace WaterPlatform.BuildingBlocks.Application.Commands;

public interface IIdempotentCommand<TResult> : ICommand<TResult>
{
    string IdempotencyKey { get; }
}
