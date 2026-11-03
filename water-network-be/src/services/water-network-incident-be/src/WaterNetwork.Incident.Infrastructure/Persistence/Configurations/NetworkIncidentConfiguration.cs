using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;

namespace WaterNetwork.Incident.Infrastructure.Persistence.Configurations;

public sealed class NetworkIncidentConfiguration : IEntityTypeConfiguration<NetworkIncidentPersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkIncidentPersistenceModel> builder)
    {
        builder.ToTable("network_incidents");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Category).HasColumnName("category").HasMaxLength(32).IsRequired();
        builder.Property(x => x.Severity).HasColumnName("severity").IsRequired();
        builder.Property(x => x.Longitude).HasColumnName("longitude");
        builder.Property(x => x.Latitude).HasColumnName("latitude");
        builder.Property(x => x.Location).HasColumnName("location").HasColumnType("geometry(Point,4326)");
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.ReportedBy).HasColumnName("reported_by").HasMaxLength(128).IsRequired();
        builder.Property(x => x.CancellationReason).HasColumnName("cancellation_reason").HasMaxLength(1000);
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.Status }).HasDatabaseName("ix_incidents_tenant_status");
        builder.HasIndex(x => new { x.TenantId, x.Severity }).HasDatabaseName("ix_incidents_tenant_severity");

        builder.HasMany(x => x.AffectedAssets).WithOne().HasForeignKey(a => a.IncidentId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(x => x.TimelineEntries).WithOne().HasForeignKey(t => t.IncidentId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(x => x.IsolationPlans).WithOne().HasForeignKey(p => p.IncidentId).OnDelete(DeleteBehavior.Cascade);
    }
}
