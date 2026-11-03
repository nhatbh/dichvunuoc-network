using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;

namespace WaterNetwork.Incident.Infrastructure.Persistence.Configurations;

public sealed class IncidentAffectedAssetConfiguration : IEntityTypeConfiguration<IncidentAffectedAssetModel>
{
    public void Configure(EntityTypeBuilder<IncidentAffectedAssetModel> builder)
    {
        builder.ToTable("incident_affected_assets");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.IncidentId).HasColumnName("incident_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Kind).HasColumnName("kind").HasMaxLength(16).IsRequired();
        builder.Property(x => x.Verified).HasColumnName("verified").IsRequired();
        builder.HasIndex(x => new { x.TenantId, x.IncidentId }).HasDatabaseName("ix_affected_assets_tenant_incident");
    }
}
