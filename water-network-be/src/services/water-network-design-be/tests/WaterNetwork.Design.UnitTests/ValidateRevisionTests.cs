// ValidateRevisionTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Services;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class ValidateRevisionTests
{
    private sealed class FakeRevisions(DesignRevision? rev) : IDesignRevisionRepository
    {
        public DesignRevision? Saved { get; private set; }
        public Task<int> GetNextRevisionNumberAsync(string t, string p, CancellationToken ct = default) => Task.FromResult(1);
        public Task<DesignRevision> SaveAsync(DesignRevision a, CancellationToken ct = default) { Saved = a; return Task.FromResult(a); }
        public Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default) => Task.FromResult(rev);
        public Task DeleteAsync(string id, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeDrafts(params DraftNetworkAsset[] items) : IDraftNetworkAssetRepository
    {
        public Task AddAsync(DraftNetworkAsset d, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddRangeAsync(IReadOnlyList<DraftNetworkAsset> d, CancellationToken ct = default) => Task.CompletedTask;
        public Task<DraftNetworkAsset?> GetByIdAsync(string t, string id, CancellationToken ct = default) => Task.FromResult<DraftNetworkAsset?>(null);
        public Task<IReadOnlyList<DraftNetworkAsset>> ListByRevisionAsync(string t, string r, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<DraftNetworkAsset>>(items);
        public Task UpdateAsync(DraftNetworkAsset d, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeGis(params string[] existing) : IGisLookupPort
    {
        public Task<bool> AssetCodeExists(string t, string code, CancellationToken ct = default) => Task.FromResult(existing.Contains(code));
    }

    private sealed class FixedTenant(string id = "tenant-1") : ITenantContextAccessor
    {
        public TenantContext? Current => new(id);
    }

    private static DraftNetworkAsset Node(string code) => DraftNetworkAsset.Create(
        "rev", "tenant-1", DraftAssetKind.Node, code, null,
        new DraftGeometry(DraftGeometryType.Point, new[] { new GeoCoordinate(105.8, 21.0) }),
        new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null);

    [Fact]
    public async Task Valid_Revision_Becomes_Validated()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        var revisions = new FakeRevisions(rev);
        var handler = new ValidateRevisionCommandHandler(
            revisions, new FakeDrafts(Node("N-1")), new DraftValidationService(), new FakeGis(), new FixedTenant());

        var dto = await handler.HandleAsync(new ValidateRevisionCommand(rev.Id), CancellationToken.None);

        dto.IsValid.Should().BeTrue();
        revisions.Saved!.Status.Should().Be(DesignRevisionStatus.Validated);
    }

    [Fact]
    public async Task Revision_With_Errors_Stays_Draft_And_Reports_Errors()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        var revisions = new FakeRevisions(rev);
        var handler = new ValidateRevisionCommandHandler(
            revisions, new FakeDrafts(Node("DUP"), Node("DUP")), new DraftValidationService(), new FakeGis(), new FixedTenant());

        var dto = await handler.HandleAsync(new ValidateRevisionCommand(rev.Id), CancellationToken.None);

        dto.IsValid.Should().BeFalse();
        dto.Errors.Should().Contain(e => e.Code == "DuplicateAssetCode");
        revisions.Saved!.Status.Should().Be(DesignRevisionStatus.Draft);
    }

    [Fact]
    public async Task Missing_Revision_Throws_NotFound()
    {
        var handler = new ValidateRevisionCommandHandler(
            new FakeRevisions(null), new FakeDrafts(), new DraftValidationService(), new FakeGis(), new FixedTenant());
        var act = () => handler.HandleAsync(new ValidateRevisionCommand("nope"), CancellationToken.None);
        await act.Should().ThrowAsync<NotFoundException>();
    }
}
