namespace WaterPlatform.BuildingBlocks.Application.Commands;

/// <summary>
/// Persistent store for idempotent command results.
/// </summary>
/// <remarks>
/// <para>
/// <strong>Atomicity contract:</strong> Implementations MUST enforce an atomic
/// check-and-set when persisting results (e.g., a unique constraint or an
/// <c>INSERT … ON CONFLICT DO NOTHING</c> statement). The behavior's
/// check-then-execute-then-mark sequence is not atomic: without enforcement at
/// the storage layer a race between two concurrent requests with the same key
/// can cause the handler to be executed more than once.
/// </para>
/// <para>
/// <strong>Serialization contract:</strong> <see cref="MarkAsProcessedAsync"/>
/// receives a JSON-serialized result produced with default
/// <see cref="System.Text.Json.JsonSerializerOptions"/>. Implementations of
/// <see cref="GetResultAsync{TResult}"/> MUST deserialize with the same
/// default options so that the round-trip is consistent.
/// </para>
/// </remarks>
public interface IIdempotencyService
{
    /// <summary>Returns <c>true</c> if the key has already been processed.</summary>
    Task<bool> HasBeenProcessedAsync(string idempotencyKey, CancellationToken ct = default);

    /// <summary>
    /// Marks the key as processed and stores <paramref name="result"/> as a
    /// JSON string serialized with default <see cref="System.Text.Json.JsonSerializerOptions"/>.
    /// </summary>
    Task MarkAsProcessedAsync(string idempotencyKey, string result, CancellationToken ct = default);

    /// <summary>
    /// Retrieves the previously stored result, deserializing with the same
    /// default <see cref="System.Text.Json.JsonSerializerOptions"/> used during
    /// <see cref="MarkAsProcessedAsync"/>.
    /// </summary>
    Task<TResult?> GetResultAsync<TResult>(string idempotencyKey, CancellationToken ct = default);
}
