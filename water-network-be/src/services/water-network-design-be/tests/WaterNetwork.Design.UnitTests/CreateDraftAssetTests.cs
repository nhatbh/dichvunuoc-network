// CreateDraftAssetTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class CreateDraftAssetTests
{
    private sealed class FakeRevisions(DesignRevision? rev) : IDesignRevisionRepository
    {
        public DesignRevision? Saved { get; private set; }
        public Task<int> GetNextRevisionNumberAsync(string t, string p, CancellationToken ct = default) => Task.FromResult(1);
        public Task<DesignRevision> SaveAsync(DesignRevision a, CancellationToken ct = default) { Saved = a; return Task.FromResult(a); }
        public Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default) => Task.FromResult(rev);
        public Task DeleteAsync(string id, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeDrafts : IDraftNetworkAssetRepository
    {
        public List<DraftNetworkAsset> Added { get; } = new();
        public Task AddAsync(DraftNetworkAsset d, CancellationToken ct = default) { Added.Add(d); return Task.CompletedTask; }
        public Task AddRangeAsync(IReadOnlyList<DraftNetworkAsset> d, CancellationToken ct = default) { Added.AddRange(d); return Task.CompletedTask; }
        public Task<DraftNetworkAsset?> GetByIdAsync(string t, string id, CancellationToken ct = default) => Task.FromResult<DraftNetworkAsset?>(null);
        public Task<IReadOnlyList<DraftNetworkAsset>> ListByRevisionAsync(string t, string r, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<DraftNetworkAsset>>(Added);
        public Task UpdateAsync(DraftNetworkAsset d, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FixedTenant(string id = "tenant-1") : ITenantContextAccessor
    {
        public TenantContext? Current => new(id);
    }

    private static readonly IReadOnlyList<IReadOnlyList<double>> PointCoords =
        new[] { new[] { 105.8, 21.0 } };

    private static DraftAssetInput NodeInput(string code, string? clientRef = null) => new(
        "Node", code, clientRef,
        new DraftGeometryInput("Point", PointCoords),
        new Dictionary<string, string> { ["nodeType"] = "Junction" }, null, null, null);

    [Fact]
    public async Task Single_Create_Adds_Draft()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        var drafts = new FakeDrafts();
        var handler = new CreateDraftAssetCommandHandler(new FakeRevisions(rev), drafts, new FixedTenant());

        var id = await handler.HandleAsync(new CreateDraftAssetCommand(rev.Id, NodeInput("N-1")), CancellationToken.None);

        id.Should().NotBeNullOrEmpty();
        drafts.Added.Should().ContainSingle().Which.AssetCode.Should().Be("N-1");
    }

    [Fact]
    public async Task Create_On_Missing_Revision_Throws_NotFound()
    {
        var handler = new CreateDraftAssetCommandHandler(new FakeRevisions(null), new FakeDrafts(), new FixedTenant());
        var act = () => handler.HandleAsync(new CreateDraftAssetCommand("nope", NodeInput("N-1")), CancellationToken.None);
        await act.Should().ThrowAsync<NotFoundException>();
    }

    [Fact]
    public async Task Create_On_Other_Tenant_Revision_Throws_NotFound()
    {
        var rev = DesignRevision.Create("p1", "tenant-OTHER", 1);
        var handler = new CreateDraftAssetCommandHandler(new FakeRevisions(rev), new FakeDrafts(), new FixedTenant("tenant-1"));
        var act = () => handler.HandleAsync(new CreateDraftAssetCommand(rev.Id, NodeInput("N-1")), CancellationToken.None);
        await act.Should().ThrowAsync<NotFoundException>();
    }

    [Fact]
    public async Task Create_On_Validated_Revision_Resets_To_Draft()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        rev.ApplyValidation(ValidationResult.Empty); // → Validated
        var revisions = new FakeRevisions(rev);
        var handler = new CreateDraftAssetCommandHandler(revisions, new FakeDrafts(), new FixedTenant());

        await handler.HandleAsync(new CreateDraftAssetCommand(rev.Id, NodeInput("N-1")), CancellationToken.None);

        revisions.Saved!.Status.Should().Be(DesignRevisionStatus.Draft);
    }

    [Fact]
    public async Task Batch_Create_Adds_All()
    {
        var rev = DesignRevision.Create("p1", "tenant-1", 1);
        var drafts = new FakeDrafts();
        var handler = new CreateDraftAssetsBatchCommandHandler(new FakeRevisions(rev), drafts, new FixedTenant());

        var ids = await handler.HandleAsync(
            new CreateDraftAssetsBatchCommand(rev.Id, new[] { NodeInput("N-1", "c1"), NodeInput("N-2", "c2") }),
            CancellationToken.None);

        ids.Should().HaveCount(2);
        drafts.Added.Should().HaveCount(2);
    }
}
