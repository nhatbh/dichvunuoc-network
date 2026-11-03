using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Ports;

namespace WaterNetwork.Design.Infrastructure.GisLookup;

/// <summary>Test/development adapter. Production startup rejects this provider.</summary>
public sealed class StubGisLookupAdapter(IOptions<GisLookupOptions> options) : IGisLookupPort
{
    private readonly HashSet<string> _existing = new(options.Value.ExistingCodes, StringComparer.Ordinal);

    public Task<bool> AssetCodeExists(string tenantId, string assetCode, CancellationToken ct = default)
        => Task.FromResult(_existing.Contains(assetCode));
}
