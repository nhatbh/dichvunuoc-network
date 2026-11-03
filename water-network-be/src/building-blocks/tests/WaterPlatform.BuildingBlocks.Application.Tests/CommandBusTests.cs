using System.Reflection;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Application.Tests;

public sealed record CreateThingCommand(string Name) : ICommand<string>;
public sealed record PingCommand : ICommand;

public sealed class CreateThingHandler : ICommandHandler<CreateThingCommand, string>
{
    public Task<string> HandleAsync(CreateThingCommand command, CancellationToken ct)
        => Task.FromResult($"created:{command.Name}");
}

public sealed class PingHandler : ICommandHandler<PingCommand, Unit>
{
    public static bool Called;
    public Task<Unit> HandleAsync(PingCommand command, CancellationToken ct)
    {
        Called = true;
        return Task.FromResult(default(Unit));
    }
}

public sealed class RecordingBehavior(List<string> log, string name) : ICommandPipelineBehavior
{
    public async Task<TResult> HandleAsync<TCommand, TResult>(
        TCommand command, Func<Task<TResult>> continuation, CancellationToken ct)
        where TCommand : ICommand<TResult>
    {
        log.Add($"{name}:before");
        var result = await continuation();
        log.Add($"{name}:after");
        return result;
    }
}

public class CommandBusTests
{
    private static ServiceProvider BuildProvider(Action<IServiceCollection>? extra = null)
    {
        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        services.AddScoped<ICommandHandler<CreateThingCommand, string>, CreateThingHandler>();
        services.AddScoped<ICommandHandler<PingCommand, Unit>, PingHandler>();
        extra?.Invoke(services);
        return services.BuildServiceProvider();
    }

    [Fact]
    public async Task ExecuteAsync_Resolves_Handler_And_Returns_Result()
    {
        await using var sp = BuildProvider();
        var bus = sp.GetRequiredService<ICommandBus>();
        var result = await bus.ExecuteAsync(new CreateThingCommand("a"));
        result.Should().Be("created:a");
    }

    [Fact]
    public async Task ExecuteAsync_Void_Command_Invokes_Handler()
    {
        PingHandler.Called = false;
        await using var sp = BuildProvider();
        var bus = sp.GetRequiredService<ICommandBus>();
        await bus.ExecuteAsync(new PingCommand());
        PingHandler.Called.Should().BeTrue();
    }

    [Fact]
    public async Task ExecuteAsync_Runs_Behaviors_In_Registration_Order()
    {
        var log = new List<string>();
        await using var sp = BuildProvider(s =>
        {
            s.AddScoped<ICommandPipelineBehavior>(_ => new RecordingBehavior(log, "outer"));
            s.AddScoped<ICommandPipelineBehavior>(_ => new RecordingBehavior(log, "inner"));
        });
        var bus = sp.GetRequiredService<ICommandBus>();
        await bus.ExecuteAsync(new CreateThingCommand("a"));
        log.Should().Equal("outer:before", "inner:before", "inner:after", "outer:after");
    }

    [Fact]
    public async Task ExecuteAsync_Throws_When_No_Handler_Registered()
    {
        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        await using var sp = services.BuildServiceProvider();
        var bus = sp.GetRequiredService<ICommandBus>();
        var act = () => bus.ExecuteAsync(new CreateThingCommand("a"));
        await act.Should().ThrowAsync<InvalidOperationException>();
    }

    // -------------------------------------------------------------------
    // Fix 3: duplicate-registration prevention
    // -------------------------------------------------------------------

    [Fact]
    public void AddHandlersFromAssembly_CalledTwice_DoesNotDuplicateRegistrations()
    {
        var services = new ServiceCollection();
        var asm = typeof(CreateThingHandler).Assembly;

        services.AddHandlersFromAssembly(asm);
        var countAfterFirst = services.Count(sd =>
            sd.ServiceType == typeof(ICommandHandler<CreateThingCommand, string>));

        services.AddHandlersFromAssembly(asm); // second call must be idempotent
        var countAfterSecond = services.Count(sd =>
            sd.ServiceType == typeof(ICommandHandler<CreateThingCommand, string>));

        countAfterSecond.Should().Be(countAfterFirst,
            "calling AddHandlersFromAssembly twice must not register duplicate (interface, impl) pairs");
    }

    [Fact]
    public void AddPlatformCqrsBehaviors_CalledTwice_RegistersExactlyTwoBehaviors()
    {
        var services = new ServiceCollection();
        services.AddPlatformCqrsBehaviors();
        services.AddPlatformCqrsBehaviors(); // second call must be idempotent

        // Inspect descriptors directly — no need to build/resolve the provider.
        var count = services.Count(sd =>
            sd.ServiceType == typeof(ICommandPipelineBehavior));
        count.Should().Be(2,
            "AddPlatformCqrsBehaviors called twice must still yield exactly 2 behaviors (Logging + Idempotency)");
    }

    // -------------------------------------------------------------------
    // Fix 4: pipeline robustness
    // -------------------------------------------------------------------

    [Fact]
    public async Task ExecuteAsync_HandlerException_PropagatesOutOfExecuteAsync()
    {
        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        services.AddScoped<ICommandHandler<CreateThingCommand, string>>(
            _ => new ThrowingHandler());
        await using var sp = services.BuildServiceProvider();

        var bus = sp.GetRequiredService<ICommandBus>();
        var act = () => bus.ExecuteAsync(new CreateThingCommand("x"));

        var ex = await act.Should().ThrowAsync<InvalidOperationException>();
        ex.WithMessage("boom");
    }

    [Fact]
    public async Task ExecuteAsync_CancellationToken_ReachesHandler()
    {
        using var cts = new CancellationTokenSource();
        CancellationToken capturedCt = default;

        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        services.AddScoped<ICommandHandler<CreateThingCommand, string>>(
            _ => new CapturingHandler(ct => capturedCt = ct));
        await using var sp = services.BuildServiceProvider();

        cts.Cancel();
        // The handler itself doesn't throw; it just captures the token.
        await sp.GetRequiredService<ICommandBus>()
            .ExecuteAsync(new CreateThingCommand("y"), cts.Token);

        capturedCt.IsCancellationRequested.Should().BeTrue(
            "the cancellation token passed to ExecuteAsync must reach the handler");
    }
}

// ---------------------------------------------------------------------------
// Helpers for Fix 4 tests
// ---------------------------------------------------------------------------
internal sealed class ThrowingHandler : ICommandHandler<CreateThingCommand, string>
{
    public Task<string> HandleAsync(CreateThingCommand command, CancellationToken ct)
        => throw new InvalidOperationException("boom");
}

internal sealed class CapturingHandler(Action<CancellationToken> capture)
    : ICommandHandler<CreateThingCommand, string>
{
    public Task<string> HandleAsync(CreateThingCommand command, CancellationToken ct)
    {
        capture(ct);
        return Task.FromResult("ok");
    }
}
