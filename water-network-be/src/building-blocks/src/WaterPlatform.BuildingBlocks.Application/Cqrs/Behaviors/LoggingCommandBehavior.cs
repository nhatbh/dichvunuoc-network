using System.Diagnostics;
using Microsoft.Extensions.Logging;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterPlatform.BuildingBlocks.Application.Cqrs.Behaviors;

public sealed partial class LoggingCommandBehavior(ILogger<LoggingCommandBehavior> logger) : ICommandPipelineBehavior
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Executing command {CommandName}")]
    private static partial void LogExecuting(ILogger logger, string commandName);

    [LoggerMessage(Level = LogLevel.Information, Message = "Executed command {CommandName} in {ElapsedMs}ms")]
    private static partial void LogExecuted(ILogger logger, string commandName, long elapsedMs);

    [LoggerMessage(Level = LogLevel.Error, Message = "Command {CommandName} failed after {ElapsedMs}ms")]
    private static partial void LogFailed(ILogger logger, Exception ex, string commandName, long elapsedMs);

    public async Task<TResult> HandleAsync<TCommand, TResult>(
        TCommand command, Func<Task<TResult>> continuation, CancellationToken ct)
        where TCommand : ICommand<TResult>
    {
        var commandName = typeof(TCommand).Name;
        var sw = Stopwatch.StartNew();
        LogExecuting(logger, commandName);
        try
        {
            var result = await continuation();
            LogExecuted(logger, commandName, sw.ElapsedMilliseconds);
            return result;
        }
        catch (Exception ex)
        {
            LogFailed(logger, ex, commandName, sw.ElapsedMilliseconds);
            throw;
        }
    }
}
