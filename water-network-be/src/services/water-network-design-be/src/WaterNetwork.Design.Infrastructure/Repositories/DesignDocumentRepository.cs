using Microsoft.EntityFrameworkCore;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.Repositories;
using WaterNetwork.Design.Infrastructure.Persistence;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Repositories;

public sealed class DesignDocumentRepository(
    DesignDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<DesignDocument>(dbContext, eventDispatcher, outboxRepository), IDesignDocumentRepository
{
    public override async Task<DesignDocument?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<DesignDocumentPersistenceModel>().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : DesignDocument.Reconstitute(
            m.Id, m.ProjectId, m.TenantId, m.FileName, m.ContentType, m.SizeBytes, m.FileRef,
            m.DocumentType, m.UploadedBy, m.Version, m.CreatedAt, m.UpdatedAt);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Design documents are not deleted in DSN-1.");

    protected override async Task PersistAsync(DesignDocument aggregate, int expectedVersion, CancellationToken ct)
    {
        // Documents are insert-only; a colliding id is a duplicate, not an update-version mismatch.
        var exists = await dbContext.Set<DesignDocumentPersistenceModel>().AnyAsync(x => x.Id == aggregate.Id, ct);
        if (exists)
            throw ConflictException.Duplicate("DesignDocument", nameof(aggregate.Id), aggregate.Id);

        dbContext.Add(new DesignDocumentPersistenceModel
        {
            Id = aggregate.Id,
            ProjectId = aggregate.ProjectId,
            TenantId = aggregate.TenantId,
            FileName = aggregate.FileName,
            ContentType = aggregate.ContentType,
            SizeBytes = aggregate.SizeBytes,
            FileRef = aggregate.FileRef,
            DocumentType = aggregate.DocumentType,
            UploadedBy = aggregate.UploadedBy,
            Version = aggregate.Version,
            CreatedAt = aggregate.CreatedAt,
            UpdatedAt = aggregate.UpdatedAt
        });
    }
}
