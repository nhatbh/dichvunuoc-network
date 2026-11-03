using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;

namespace WaterNetwork.Incident.Infrastructure.Persistence.Configurations;

public sealed class IncidentTimelineEntryConfiguration : IEntityTypeConfiguration<IncidentTimelineEntryModel>
{
    public void Configure(EntityTypeBuilder<IncidentTimelineEntryModel> builder)
    {
        builder.ToTable("incident_timeline_entries");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.IncidentId).HasColumnName("incident_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.EntryType).HasColumnName("entry_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.ActorId).HasColumnName("actor_id").HasMaxLength(128).IsRequired();
        builder.Property(x => x.Note).HasColumnName("note").HasMaxLength(1000);
        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at");
        builder.Property(x => x.Sequence).HasColumnName("sequence");
        builder.HasIndex(x => new { x.TenantId, x.IncidentId }).HasDatabaseName("ix_timeline_tenant_incident");
    }
}
