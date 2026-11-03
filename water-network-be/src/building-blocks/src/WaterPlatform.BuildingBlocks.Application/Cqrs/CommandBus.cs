using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs;

internal abstract class CommandHandlerWrapper<TResult>
{
    public abstract Task<TResult> Handle(ICommand<TResult> command, IServiceProvider sp, CancellationToken ct);
}

internal sealed class CommandHandlerWrapperImpl<TCommand, TResult> : CommandHandlerWrapper<TResult>
    where TCommand : ICommand<TResult>
{
    public override Task<TResult> Handle(ICommand<TResult> command, IServiceProvider sp, CancellationToken ct)
    {
        var behaviors = sp.GetServices<ICommandPipelineBehavior>().ToArray();
        Func<Task<TResult>> next = () => sp.GetRequiredService<ICommandHandler<TCommand, TResult>>()
            .HandleAsync((TCommand)command, ct);

        for (var i = behaviors.Length - 1; i >= 0; i--)
        {
            var behavior = behaviors[i];
            var current = next;
            next = () => behavior.HandleAsync<TCommand, TResult>((TCommand)command, current, ct);
        }

        return next();
    }
}

internal sealed class CommandBus(IServiceProvider serviceProvider) : ICommandBus
{
    // Cache is keyed by command Type whose ICommand<TResult> fixes TResult, so a process-global static cache is safe.
    private static readonly ConcurrentDictionary<Type, object> Wrappers = new();

    public Task<TResult> ExecuteAsync<TResult>(ICommand<TResult> command, CancellationToken ct = default)
    {
        var wrapper = (CommandHandlerWrapper<TResult>)Wrappers.GetOrAdd(command.GetType(), static commandType =>
            Activator.CreateInstance(
                typeof(CommandHandlerWrapperImpl<,>).MakeGenericType(commandType, typeof(TResult)))!);
        return wrapper.Handle(command, serviceProvider, ct);
    }

    public Task ExecuteAsync(ICommand command, CancellationToken ct = default)
        => ExecuteAsync<Unit>(command, ct);
}
