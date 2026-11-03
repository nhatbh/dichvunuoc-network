using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using WaterPlatform.BuildingBlocks.Application.Commands;
using WaterPlatform.BuildingBlocks.Application.Cqrs;
using Xunit;

namespace WaterPlatform.BuildingBlocks.Application.Tests;

// ---------------------------------------------------------------------------
// Fake IIdempotencyService — in-memory dictionary
// ---------------------------------------------------------------------------
internal sealed class FakeIdempotencyService : IIdempotencyService
{
    private readonly Dictionary<string, string> _store = new();

    public int HasBeenProcessedCallCount { get; private set; }
    public int MarkAsProcessedCallCount { get; private set; }
    public int GetResultCallCount { get; private set; }

    public Task<bool> HasBeenProcessedAsync(string idempotencyKey, CancellationToken ct = default)
    {
        HasBeenProcessedCallCount++;
        return Task.FromResult(_store.ContainsKey(idempotencyKey));
    }

    public Task MarkAsProcessedAsync(string idempotencyKey, string result, CancellationToken ct = default)
    {
        MarkAsProcessedCallCount++;
        _store[idempotencyKey] = result;
        return Task.CompletedTask;
    }

    public Task<TResult?> GetResultAsync<TResult>(string idempotencyKey, CancellationToken ct = default)
    {
        GetResultCallCount++;
        if (!_store.TryGetValue(idempotencyKey, out var json))
            return Task.FromResult(default(TResult));
        return Task.FromResult(System.Text.Json.JsonSerializer.Deserialize<TResult>(json));
    }
}

// ---------------------------------------------------------------------------
// Test commands
// ---------------------------------------------------------------------------

/// <summary>Idempotent command that returns a non-null string.</summary>
public sealed record IdempotentStringCommand(string Name, string IdempotencyKey)
    : ICommand<string>, IIdempotentCommand<string>;

/// <summary>
/// Idempotent void command. ICommand : ICommand&lt;Unit&gt;, so this is
/// IIdempotentCommand&lt;Unit&gt;.
/// </summary>
public sealed record IdempotentVoidCommand(string IdempotencyKey)
    : ICommand, IIdempotentCommand<Unit>;

/// <summary>
/// Idempotent command whose handler legitimately returns null — the case
/// that broke the unfixed <c>if (cached is not null)</c> guard.
/// </summary>
public sealed record IdempotentNullableCommand(string IdempotencyKey)
    : ICommand<string?>, IIdempotentCommand<string?>;

/// <summary>Non-idempotent command — bypasses the service entirely.</summary>
public sealed record PlainCommand2(string Name) : ICommand<string>;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
internal sealed class IdempotentStringHandler : ICommandHandler<IdempotentStringCommand, string>
{
    public int CallCount { get; private set; }

    public Task<string> HandleAsync(IdempotentStringCommand command, CancellationToken ct)
    {
        CallCount++;
        return Task.FromResult($"result:{command.Name}");
    }
}

internal sealed class IdempotentVoidHandler : ICommandHandler<IdempotentVoidCommand, Unit>
{
    public int CallCount { get; private set; }

    public Task<Unit> HandleAsync(IdempotentVoidCommand command, CancellationToken ct)
    {
        CallCount++;
        return Task.FromResult(Unit.Value);
    }
}

internal sealed class IdempotentNullableHandler : ICommandHandler<IdempotentNullableCommand, string?>
{
    public int CallCount { get; private set; }

    public Task<string?> HandleAsync(IdempotentNullableCommand command, CancellationToken ct)
    {
        CallCount++;
        // Deliberately returns null — the result the behavior must cache
        // and replay unconditionally on second dispatch.
        return Task.FromResult<string?>(null);
    }
}

internal sealed class PlainCommandHandler2 : ICommandHandler<PlainCommand2, string>
{
    public Task<string> HandleAsync(PlainCommand2 command, CancellationToken ct)
        => Task.FromResult($"plain:{command.Name}");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
public class IdempotencyCommandBehaviorTests
{
    private static (ServiceProvider sp, FakeIdempotencyService fake) BuildProvider(
        Action<IServiceCollection>? extra = null)
    {
        var fake = new FakeIdempotencyService();
        var services = new ServiceCollection();
        services.AddPlatformCqrs();
        services.AddScoped<IIdempotencyService>(_ => fake);
        services.AddScoped<ICommandPipelineBehavior,
            WaterPlatform.BuildingBlocks.Application.Cqrs.Behaviors.IdempotencyCommandBehavior>();
        extra?.Invoke(services);
        return (services.BuildServiceProvider(), fake);
    }

    // -----------------------------------------------------------------------
    // Test 1: Idempotent command with TResult=string — second dispatch returns
    //         cached value and handler is invoked exactly once.
    // -----------------------------------------------------------------------
    [Fact]
    public async Task IdempotentStringCommand_SecondDispatch_ReturnsCachedValue_HandlerCalledOnce()
    {
        var handler = new IdempotentStringHandler();
        var (sp, _) = BuildProvider(s =>
            s.AddScoped<ICommandHandler<IdempotentStringCommand, string>>(_ => handler));

        await using var _ = sp;
        var bus = sp.GetRequiredService<ICommandBus>();
        var cmd = new IdempotentStringCommand("foo", "key-1");

        var first = await bus.ExecuteAsync(cmd);
        var second = await bus.ExecuteAsync(cmd);

        first.Should().Be("result:foo");
        second.Should().Be("result:foo");
        handler.CallCount.Should().Be(1, "handler must not be called on the second dispatch");
    }

    // -----------------------------------------------------------------------
    // Test 2: Idempotent VOID command — second dispatch does NOT re-invoke
    //         handler (Unit is a value type; this proved the bug before
    //         Fix 1 because the old code had `if (cached is not null)`
    //         which would re-execute when GetResultAsync returned default).
    // -----------------------------------------------------------------------
    [Fact]
    public async Task IdempotentVoidCommand_SecondDispatch_DoesNotReinvokeHandler()
    {
        var handler = new IdempotentVoidHandler();
        var (sp, _) = BuildProvider(s =>
            s.AddScoped<ICommandHandler<IdempotentVoidCommand, Unit>>(_ => handler));

        await using var _ = sp;
        var bus = sp.GetRequiredService<ICommandBus>();
        var cmd = new IdempotentVoidCommand("key-void");

        await bus.ExecuteAsync(cmd);
        await bus.ExecuteAsync(cmd);

        handler.CallCount.Should().Be(1, "void handler must not be called on the second dispatch");
    }

    // -----------------------------------------------------------------------
    // Test 3 (Bug proof — fails BEFORE Fix 1): idempotent command whose
    //         handler returns null — old `if (cached is not null)` guard
    //         sees null and falls through to re-execute the handler.
    // -----------------------------------------------------------------------
    [Fact]
    public async Task IdempotentNullableCommand_NullResult_SecondDispatch_DoesNotReinvokeHandler()
    {
        var handler = new IdempotentNullableHandler();
        var (sp, _) = BuildProvider(s =>
            s.AddScoped<ICommandHandler<IdempotentNullableCommand, string?>>(_ => handler));

        await using var _ = sp;
        var bus = sp.GetRequiredService<ICommandBus>();
        var cmd = new IdempotentNullableCommand("key-null");

        await bus.ExecuteAsync(cmd);   // first — stores null result
        await bus.ExecuteAsync(cmd);   // second — must NOT call handler again

        handler.CallCount.Should().Be(1,
            "null result must not cause re-execution; old `if (cached is not null)` guard was the bug");
    }

    // -----------------------------------------------------------------------
    // Test 4: Non-idempotent command bypasses the service entirely.
    // -----------------------------------------------------------------------
    [Fact]
    public async Task NonIdempotentCommand_Bypasses_IdempotencyService()
    {
        var (sp, fake) = BuildProvider(s =>
            s.AddScoped<ICommandHandler<PlainCommand2, string>, PlainCommandHandler2>());

        await using var _ = sp;
        var bus = sp.GetRequiredService<ICommandBus>();

        await bus.ExecuteAsync(new PlainCommand2("x"));

        fake.HasBeenProcessedCallCount.Should().Be(0,
            "service must not be consulted for non-idempotent commands");
        fake.MarkAsProcessedCallCount.Should().Be(0);
        fake.GetResultCallCount.Should().Be(0);
    }
}
