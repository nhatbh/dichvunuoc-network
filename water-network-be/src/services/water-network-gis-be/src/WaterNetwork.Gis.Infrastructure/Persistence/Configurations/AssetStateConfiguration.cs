using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class AssetStateConfiguration : IEntityTypeConfiguration<AssetStatePersistenceModel>
{
    public void Configure(EntityTypeBuilder<AssetStatePersistenceModel> builder)
    {
        builder.ToTable("network_asset_states");
        builder.HasKey(x => x.AssetId);
        builder.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.LifecycleStatus).HasColumnName("lifecycle_status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at").IsRequired();
        builder.Property(x => x.LastEventId).HasColumnName("last_event_id").HasMaxLength(64).IsRequired();

        builder.HasIndex(x => x.TenantId).HasDatabaseName("ix_asset_states_tenant");

        // No HasQueryFilter: projection has no soft-delete; bbox joins it explicitly.
    }
}
