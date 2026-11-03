namespace WaterPlatform.BuildingBlocks.WebApi.Tests;

/// <summary>
/// Marker class used by tests. The middleware/host is configured directly
/// in each test (no <c>WebApplicationFactory</c>), so no Program/Main is
/// required.
/// </summary>
public sealed class TestStartup
{
    private TestStartup() { }
}
