using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

public interface ICommandHandler<in TCommand, TResult> where TCommand : ICommand<TResult>
{
    Task<TResult> HandleAsync(TCommand command, CancellationToken ct);
}
