using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

public interface ICommandPipelineBehavior
{
    Task<TResult> HandleAsync<TCommand, TResult>(
        TCommand command, Func<Task<TResult>> continuation, CancellationToken ct)
        where TCommand : ICommand<TResult>;
}
