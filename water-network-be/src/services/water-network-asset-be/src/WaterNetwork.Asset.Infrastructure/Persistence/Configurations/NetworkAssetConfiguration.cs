using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Asset.Infrastructure.Persistence.Configurations;

public sealed class NetworkAssetConfiguration : IEntityTypeConfiguration<NetworkAssetPersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkAssetPersistenceModel> builder)
    {
        builder.ToTable("network_assets");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetType).HasColumnName("asset_type").HasMaxLength(16).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.AssetCode })
            .IsUnique().HasDatabaseName("ux_network_assets_tenant_asset_code");

        builder.HasMany(x => x.LifecycleEntries)
            .WithOne()
            .HasForeignKey(x => x.AssetId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Property(x => x.DecommissionReason).HasColumnName("decommission_reason").HasMaxLength(256);
        builder.Property(x => x.DecommissionedBy).HasColumnName("decommissioned_by").HasMaxLength(64);
        builder.HasOne(x => x.TechnicalProfile)
            .WithOne()
            .HasForeignKey<AssetTechnicalProfilePersistenceModel>(p => p.AssetId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
