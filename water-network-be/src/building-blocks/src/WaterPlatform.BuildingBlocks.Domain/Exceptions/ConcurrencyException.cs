namespace WaterPlatform.BuildingBlocks.Domain.Exceptions;

public class ConcurrencyException : BaseException
{
    public string AggregateId { get; }
    public int ExpectedVersion { get; }
    public int ActualVersion { get; }

    private ConcurrencyException(string aggregateId, int expectedVersion, int actualVersion)
        : base("CONCURRENCY_ERROR", $"Version mismatch for aggregate '{aggregateId}': expected {expectedVersion}, actual {actualVersion}.")
    {
        AggregateId = aggregateId;
        ExpectedVersion = expectedVersion;
        ActualVersion = actualVersion;
    }

    public static ConcurrencyException VersionMismatch(string aggregateId, int expectedVersion, int actualVersion)
        => new(aggregateId, expectedVersion, actualVersion);
}
