namespace WaterPlatform.BuildingBlocks.Application.Commands;

public interface ICommandBus
{
    Task<TResult> ExecuteAsync<TResult>(ICommand<TResult> command, CancellationToken ct = default);
    Task ExecuteAsync(ICommand command, CancellationToken ct = default);
}
