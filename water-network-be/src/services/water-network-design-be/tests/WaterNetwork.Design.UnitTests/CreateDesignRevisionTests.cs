// CreateDesignRevisionTests.cs
using FluentAssertions;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Application.Ports;
using WaterNetwork.Design.Application.Dtos;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class CreateDesignRevisionTests
{
    private sealed class FakeProjects(bool exists) : IDesignProjectReadDao
    {
        public Task<DesignProjectDetailDto?> GetDetailAsync(string t, string p, CancellationToken ct = default)
            => Task.FromResult<DesignProjectDetailDto?>(null);
        public Task<bool> ExistsAsync(string t, string p, CancellationToken ct = default) => Task.FromResult(exists);
    }

    private sealed class FakeRevisions(int next) : IDesignRevisionRepository
    {
        public DesignRevision? Saved { get; private set; }
        public Task<int> GetNextRevisionNumberAsync(string t, string p, CancellationToken ct = default) => Task.FromResult(next);
        public Task<DesignRevision> SaveAsync(DesignRevision a, CancellationToken ct = default) { Saved = a; return Task.FromResult(a); }
        public Task<DesignRevision?> GetByIdAsync(string id, CancellationToken ct = default) => Task.FromResult<DesignRevision?>(null);
        public Task DeleteAsync(string id, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FixedTenant : ITenantContextAccessor
    {
        public TenantContext? Current => new("tenant-1");
    }

    [Fact]
    public async Task Creates_Revision_With_Next_Number()
    {
        var revisions = new FakeRevisions(next: 3);
        var handler = new CreateDesignRevisionCommandHandler(new FakeProjects(true), revisions, new FixedTenant());

        var id = await handler.HandleAsync(new CreateDesignRevisionCommand("proj-1"), CancellationToken.None);

        id.Should().NotBeNullOrEmpty();
        revisions.Saved!.RevisionNumber.Should().Be(3);
        revisions.Saved.ProjectId.Should().Be("proj-1");
    }

    [Fact]
    public async Task Missing_Project_Throws_NotFound()
    {
        var handler = new CreateDesignRevisionCommandHandler(new FakeProjects(false), new FakeRevisions(1), new FixedTenant());
        var act = () => handler.HandleAsync(new CreateDesignRevisionCommand("nope"), CancellationToken.None);
        await act.Should().ThrowAsync<NotFoundException>();
    }
}
