using Microsoft.Extensions.Options;
using WaterNetwork.Incident.Application.Ports;
using WaterNetwork.Incident.Domain.ValueObjects;

namespace WaterNetwork.Incident.Infrastructure.GisLookup;

public sealed class StubGisLookupAdapter(IOptions<GisLookupOptions> options) : IGisLookupPort
{
    private readonly HashSet<string> _existing =
        new(options.Value.ExistingRefs, StringComparer.OrdinalIgnoreCase);

    public Task<bool> AssetRefExists(string tenantId, AssetRefKind kind, string assetId, CancellationToken ct = default)
        => Task.FromResult(_existing.Contains($"{kind}:{assetId}"));
}
