using System.Text.Json.Nodes;
using Microsoft.Extensions.Http.Resilience;

namespace WaterNetwork.Bff.Api.Http;

public enum DownstreamStatus { Ok, NotFound, Unavailable }

/// <summary>Tri-state outcome of a downstream read: success+value, an explicit 404, or any failure.</summary>
public sealed record DownstreamResult<T>(DownstreamStatus Status, T? Value)
{
#pragma warning disable CA1000 // static factory members on a generic type are intentional here
    public static DownstreamResult<T> Ok(T value) => new(DownstreamStatus.Ok, value);
    public static readonly DownstreamResult<T> NotFound = new(DownstreamStatus.NotFound, default);
    public static readonly DownstreamResult<T> Unavailable = new(DownstreamStatus.Unavailable, default);
#pragma warning restore CA1000
}

/// <summary>Passthrough outcome for the map endpoint: forward status+body verbatim, or 502 when unavailable.</summary>
public sealed record MapPassthrough(bool Unavailable, int StatusCode, JsonNode? Body);

/// <summary>Shared Polly v8 resilience policy for downstream read clients: fail-fast, no retry.</summary>
public static class ResilienceConfig
{
    public static void Configure(HttpStandardResilienceOptions o)
    {
        // reads: do not retry, fail fast. MaxRetryAttempts=0 is rejected by the
        // options validator (min 1), so keep the minimum and make the retry predicate
        // never match — effectively disabling retries without tripping validation.
        o.Retry.MaxRetryAttempts = 1;
        o.Retry.ShouldHandle = _ => ValueTask.FromResult(false);
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(1);
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(2);
        o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(2); // must be >= 2 * AttemptTimeout
    }
}
