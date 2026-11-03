using Microsoft.EntityFrameworkCore;
using NetTopologySuite;
using NetTopologySuite.Geometries;
using WaterNetwork.Incident.Domain.Aggregates;
using WaterNetwork.Incident.Domain.Entities;
using WaterNetwork.Incident.Domain.Repositories;
using WaterNetwork.Incident.Domain.ValueObjects;
using WaterNetwork.Incident.Infrastructure.Persistence;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;
using WaterPlatform.BuildingBlocks.Application.Events;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;
using WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

namespace WaterNetwork.Incident.Infrastructure.Repositories;

public sealed class NetworkIncidentRepository(
    IncidentDbContext dbContext,
    IDomainEventDispatcher eventDispatcher,
    IOutboxRepository outboxRepository)
    : AggregateRepositoryBase<NetworkIncident>(dbContext, eventDispatcher, outboxRepository), INetworkIncidentRepository
{
    private static readonly GeometryFactory GeometryFactory =
        NtsGeometryServices.Instance.CreateGeometryFactory(srid: 4326);

    public override async Task<NetworkIncident?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var m = await dbContext.Set<NetworkIncidentPersistenceModel>()
            .AsNoTracking()
            .Include(x => x.AffectedAssets)
            .Include(x => x.TimelineEntries)
            .Include(x => x.IsolationPlans)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        return m is null ? null : ToDomain(m);
    }

    public override Task DeleteAsync(string id, CancellationToken ct = default)
        => throw new NotSupportedException("Incidents are not deleted in INC-1; use Cancel.");

    protected override async Task PersistAsync(NetworkIncident aggregate, int expectedVersion, CancellationToken ct)
    {
        var existing = await dbContext.Set<NetworkIncidentPersistenceModel>()
            .Include(x => x.AffectedAssets)
            .Include(x => x.TimelineEntries)
            .Include(x => x.IsolationPlans)
            .FirstOrDefaultAsync(x => x.Id == aggregate.Id, ct);

        if (existing is null)
        {
            if (expectedVersion > 0)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, 0);
            dbContext.Add(ToModel(aggregate));
        }
        else
        {
            if (existing.Version != expectedVersion)
                throw ConcurrencyException.VersionMismatch(aggregate.Id, expectedVersion, existing.Version);

            existing.Category = aggregate.Category.ToString();
            existing.Severity = aggregate.Severity;
            existing.Status = aggregate.Status.ToString();
            existing.CancellationReason = aggregate.CancellationReason;
            existing.Version = aggregate.Version;
            existing.UpdatedAt = aggregate.UpdatedAt;

            foreach (var entry in aggregate.TimelineEntries.Where(e => e.Sequence >= existing.TimelineEntries.Count))
                existing.TimelineEntries.Add(ToModel(entry, aggregate.Id, aggregate.TenantId));

            foreach (var plan in aggregate.IsolationPlans)
            {
                var row = existing.IsolationPlans.FirstOrDefault(p => p.Id == plan.Id);
                if (row is null)
                    existing.IsolationPlans.Add(ToModel(plan, aggregate.Id, aggregate.TenantId));
                else
                    row.Status = plan.Status.ToString();
            }
        }
    }

    private static NetworkIncidentPersistenceModel ToModel(NetworkIncident i)
    {
        Point? location = i is { Longitude: { } lng, Latitude: { } lat }
            ? GeometryFactory.CreatePoint(new Coordinate(lng, lat))
            : null;
        return new NetworkIncidentPersistenceModel
        {
            Id = i.Id,
            TenantId = i.TenantId,
            Category = i.Category.ToString(),
            Severity = i.Severity,
            Longitude = i.Longitude,
            Latitude = i.Latitude,
            Location = location,
            Status = i.Status.ToString(),
            ReportedBy = i.ReportedBy,
            CancellationReason = i.CancellationReason,
            Version = i.Version,
            CreatedAt = i.CreatedAt,
            UpdatedAt = i.UpdatedAt,
            AffectedAssets = i.AffectedRefs.Select(r => new IncidentAffectedAssetModel
            {
                Id = Guid.CreateVersion7().ToString(),
                IncidentId = i.Id,
                TenantId = i.TenantId,
                AssetId = r.AssetId,
                Kind = r.Kind.ToString(),
                Verified = r.Verified
            }).ToList(),
            TimelineEntries = i.TimelineEntries.Select(e => ToModel(e, i.Id, i.TenantId)).ToList(),
            IsolationPlans = i.IsolationPlans.Select(p => ToModel(p, i.Id, i.TenantId)).ToList(),
        };
    }

    private static IncidentTimelineEntryModel ToModel(IncidentTimelineEntry e, string incidentId, string tenantId) => new()
    {
        Id = e.Id,
        IncidentId = incidentId,
        TenantId = tenantId,
        EntryType = e.EntryType.ToString(),
        ActorId = e.ActorId,
        Note = e.Note,
        OccurredAt = e.OccurredAt,
        Sequence = e.Sequence
    };

    private static IsolationPlanModel ToModel(IsolationPlan p, string incidentId, string tenantId) => new()
    {
        Id = p.Id,
        IncidentId = incidentId,
        TenantId = tenantId,
        StartNodeId = p.StartNodeId,
        Status = p.Status.ToString(),
        GraphVersion = p.GraphVersion,
        ValvesToClose = [.. p.ValvesToClose],
        IsolatedNodes = [.. p.IsolatedNodes],
        IsolatedPipes = [.. p.IsolatedPipes],
        FailureReason = p.FailureReason,
        ComputedAt = p.ComputedAt,
        Sequence = p.Sequence
    };

    private static NetworkIncident ToDomain(NetworkIncidentPersistenceModel m) => NetworkIncident.Reconstitute(
        m.Id, m.TenantId, Enum.Parse<IncidentCategory>(m.Category), m.Severity, m.Longitude, m.Latitude,
        Enum.Parse<IncidentStatus>(m.Status), m.ReportedBy, m.CancellationReason, m.Version, m.CreatedAt, m.UpdatedAt,
        m.AffectedAssets.Select(a => AssetRef.Create(a.AssetId, Enum.Parse<AssetRefKind>(a.Kind), a.Verified)),
        m.TimelineEntries.OrderBy(t => t.Sequence).Select(t => new IncidentTimelineEntry(
            t.Id, Enum.Parse<TimelineEntryType>(t.EntryType), t.ActorId, t.Note, t.OccurredAt, t.Sequence)),
        m.IsolationPlans.OrderBy(p => p.Sequence).Select(p => IsolationPlan.Reconstitute(
            p.Id, Enum.Parse<IsolationPlanStatus>(p.Status), p.StartNodeId, p.GraphVersion,
            p.ValvesToClose, p.IsolatedNodes, p.IsolatedPipes, p.FailureReason, p.ComputedAt, p.Sequence)));
}
