// DraftValidationServiceTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Services;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;

namespace WaterNetwork.Design.UnitTests;

public sealed class DraftValidationServiceTests
{
    private sealed class FakeGisLookup(params string[] existing) : IGisLookupPort
    {
        public Task<bool> AssetCodeExists(string tenantId, string assetCode, CancellationToken ct = default)
            => Task.FromResult(existing.Contains(assetCode));
    }

    private static DraftGeometry Point(double lng = 105.8, double lat = 21.0) =>
        new(DraftGeometryType.Point, new[] { new GeoCoordinate(lng, lat) });

    private static DraftGeometry Line() => new(DraftGeometryType.LineString,
        new[] { new GeoCoordinate(105.8, 21.0), new GeoCoordinate(105.9, 21.1) });

    private static DraftNetworkAsset Node(string code, string? clientRef = null) =>
        DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Node, code, clientRef, Point(),
            new Dictionary<string, string> { ["componentCode"] = "Junction" }, null, null, null);

    private static DraftNetworkAsset Pipe(string code, string from, string to,
        Dictionary<string, string>? attrs = null) =>
        DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Pipe, code, null, Line(),
            attrs ?? new Dictionary<string, string> { ["diameterMm"] = "100", ["material"] = "PVC" },
            from, to, null);

    private readonly DraftValidationService _sut = new();

    [Fact]
    public async Task Valid_Drafts_Produce_No_Errors()
    {
        var drafts = new[] { Node("N-1", "c-n1"), Pipe("P-1", "c-n1", "c-n1b"), Node("N-2", "c-n1b") };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.HasErrors.Should().BeFalse();
    }

    [Fact]
    public async Task Duplicate_Asset_Code_In_Revision_Is_Error()
    {
        var drafts = new[] { Node("DUP"), Node("DUP") };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "DuplicateAssetCode");
    }

    [Fact]
    public async Task Asset_Code_Existing_In_Gis_Is_Error()
    {
        var drafts = new[] { Node("N-1") };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup("N-1"), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "AssetCodeExistsInGis");
    }

    [Fact]
    public async Task Pipe_Endpoint_Not_Resolving_To_Node_Is_Error()
    {
        var drafts = new[] { Pipe("P-1", "missing-from", "missing-to") };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "PipeEndpointMissing");
    }

    [Fact]
    public async Task Pipe_Missing_Diameter_Is_Error()
    {
        var pipe = Pipe("P-1", "c-n1", "c-n1b", new Dictionary<string, string> { ["material"] = "PVC" });
        var drafts = new[] { Node("N-1", "c-n1"), Node("N-2", "c-n1b"), pipe };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "MissingRequiredAttribute" && e.Field == "diameterMm");
    }

    [Fact]
    public async Task Node_Missing_ComponentCode_Is_Error()
    {
        var node = DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Node, "N-1", null, Point(),
            new Dictionary<string, string>(), null, null, null);
        var result = await _sut.ValidateAsync("t1", new[] { node }, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "MissingRequiredAttribute" && e.Field == "componentCode");
    }

    [Fact]
    public async Task Valve_Device_Without_Pipe_Host_Is_Error()
    {
        var node = Node("N-1", "c-n1");
        var device = DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Device, "D-1", null, Point(),
            new Dictionary<string, string> { ["componentCode"] = "GateValve" }, null, null, hostRef: "c-n1");
        var result = await _sut.ValidateAsync("t1", new[] { node, device }, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "InvalidDeviceHost");
    }

    private static DraftNetworkAsset Device(string code, string componentCode, string hostRef, params (string K, string V)[] props)
    {
        var attrs = new Dictionary<string, string> { ["componentCode"] = componentCode };
        foreach (var (k, v) in props) attrs[k] = v;
        return DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Device, code, null, Point(), attrs, null, null, hostRef);
    }

    [Theory]
    [InlineData("ButterflyValve", "c-p1", true)]
    [InlineData("PRV", "c-p1", true)]
    [InlineData("Washout", "c-n1", true)]
    [InlineData("AirValve", "c-n1", true)]
    [InlineData("Hydrant", "c-p1", false)]
    [InlineData("BulkMeter", "c-n1", false)]
    public async Task Device_Host_Follows_The_Catalog(string component, string hostRef, bool valid)
    {
        var pipe = DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Pipe, "P-1", "c-p1", Line(),
            new Dictionary<string, string> { ["diameterMm"] = "100", ["material"] = "PVC" }, "c-n1", "c-n1b", null);
        var drafts = new[] { Node("N-1", "c-n1"), Node("N-2", "c-n1b"), pipe, Device("D-1", component, hostRef) };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Any(e => e.Code == "InvalidDeviceHost").Should().Be(!valid);
    }

    [Fact]
    public async Task Unknown_Or_Wrong_Kind_Component_Is_Error()
    {
        var node = DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Node, "N-9", null, Point(),
            new Dictionary<string, string> { ["componentCode"] = "GateValve" }, null, null, null);
        var device = Device("D-9", "Valve", "c-n1");
        var result = await _sut.ValidateAsync("t1", new[] { Node("N-1", "c-n1"), node, device }, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "ComponentKindMismatch" && e.Field == "componentCode");
        result.Errors.Should().Contain(e => e.Code == "UnknownComponent");
    }

    [Fact]
    public async Task Invalid_Or_Foreign_Properties_Are_Errors()
    {
        var drafts = new[] { Node("N-1", "c-n1"), Device("D-1", "Hydrant", "c-n1", ("dn", "huge"), ("setpoint", "3")) };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Where(e => e.Code == "InvalidProperty").Should().HaveCount(2);
    }

    [Fact]
    public async Task Degenerate_LineString_Is_Invalid_Geometry()
    {
        // 2 identical points → NTS IsValid = false (zero-length).
        var badLine = new DraftGeometry(DraftGeometryType.LineString,
            new[] { new GeoCoordinate(105.8, 21.0), new GeoCoordinate(105.8, 21.0) });
        var pipe = DraftNetworkAsset.Create("rev-1", "t1", DraftAssetKind.Pipe, "P-1", null, badLine,
            new Dictionary<string, string> { ["diameterMm"] = "100", ["material"] = "PVC" },
            "c-n1", "c-n1b", null);
        var drafts = new[] { Node("N-1", "c-n1"), Node("N-2", "c-n1b"), pipe };
        var result = await _sut.ValidateAsync("t1", drafts, new FakeGisLookup(), CancellationToken.None);
        result.Errors.Should().Contain(e => e.Code == "InvalidGeometry");
    }
    [Fact]
    public async Task Gis_lookups_are_bounded_parallel_and_issues_stay_in_draft_order()
    {
        var drafts = Enumerable.Range(0, 48).Select(i => Node($"N-{i:D2}")).ToArray();
        var lookup = new RecordingGisLookup();
        var result = await _sut.ValidateAsync("t1", drafts, lookup, default);
        lookup.MaximumConcurrency.Should().BeInRange(2, 16);
        lookup.Calls.Should().HaveCount(48).And.OnlyContain(x => x.Tenant == "t1");
        result.Errors.Where(x => x.Code == "AssetCodeExistsInGis").Select(x => x.DraftAssetId)
            .Should().Equal(drafts.Select(x => x.Id));
    }

    [Fact]
    public async Task Draft_refs_resolve_locally_and_duplicate_codes_are_looked_up_once()
    {
        var a = Node("N-1", "from-client");
        var b = Node("N-2", "to-client");
        var p = Pipe("P-1", a.Id, "to-client");
        var lookup = new RecordingGisLookup(exists: false);
        var result = await _sut.ValidateAsync("t1", [a, p, b, Node("N-1")], lookup, default);
        lookup.Calls.Select(x => x.Code).Should().BeEquivalentTo(["N-1", "N-2", "P-1"]);
        result.Errors.Should().NotContain(x => x.Code == "PipeEndpointMissing");
        result.Errors.Should().Contain(x => x.Code == "DuplicateAssetCode");
        var emptyLookup = new RecordingGisLookup();
        (await _sut.ValidateAsync("t1", [], emptyLookup, default)).HasErrors.Should().BeFalse();
        emptyLookup.Calls.Should().BeEmpty();
    }

    [Fact]
    public async Task Cancellation_stops_pending_Gis_checks_and_does_not_return_partial_validation()
    {
        using var cancellation = new CancellationTokenSource();
        var lookup = new RecordingGisLookup(onStart: () => cancellation.Cancel());
        var drafts = Enumerable.Range(0, 100).Select(i => Node($"N-{i}")).ToArray();
        await FluentActions.Invoking(() => _sut.ValidateAsync("t1", drafts, lookup, cancellation.Token))
            .Should().ThrowAsync<OperationCanceledException>();
        lookup.Calls.Count.Should().BeLessThan(100);
    }

    private sealed class RecordingGisLookup(bool exists = true, Action? onStart = null) : IGisLookupPort
    {
        private int _concurrency;
        private int _maximum;
        public int MaximumConcurrency => _maximum;
        public System.Collections.Concurrent.ConcurrentBag<(string Tenant, string Code)> Calls { get; } = [];
        public async Task<bool> AssetCodeExists(string tenantId, string assetCode, CancellationToken ct = default)
        {
            Calls.Add((tenantId, assetCode));
            var current = Interlocked.Increment(ref _concurrency);
            int prior;
            do { prior = _maximum; }
            while (current > prior && Interlocked.CompareExchange(ref _maximum, current, prior) != prior);
            try
            {
                onStart?.Invoke();
                await Task.Delay(20, ct);
                return exists;
            }
            finally { Interlocked.Decrement(ref _concurrency); }
        }
    }

}
