using System.Text.Json;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs.Behaviors;

public sealed class IdempotencyCommandBehavior(IIdempotencyService idempotencyService) : ICommandPipelineBehavior
{
    public async Task<TResult> HandleAsync<TCommand, TResult>(
        TCommand command, Func<Task<TResult>> continuation, CancellationToken ct)
        where TCommand : ICommand<TResult>
    {
        if (command is not IIdempotentCommand<TResult> idempotent)
        {
            return await continuation();
        }

        if (await idempotencyService.HasBeenProcessedAsync(idempotent.IdempotencyKey, ct))
        {
            return (await idempotencyService.GetResultAsync<TResult>(idempotent.IdempotencyKey, ct))!;
        }

        var result = await continuation();

        await idempotencyService.MarkAsProcessedAsync(
            idempotent.IdempotencyKey, JsonSerializer.Serialize(result), ct);

        return result;
    }
}
