using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Asset.Infrastructure.Persistence.Configurations;

public sealed class AssetLifecycleEntryConfiguration : IEntityTypeConfiguration<AssetLifecycleEntryPersistenceModel>
{
    public void Configure(EntityTypeBuilder<AssetLifecycleEntryPersistenceModel> builder)
    {
        builder.ToTable("asset_lifecycle_entries");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedOnAdd();
        builder.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.FromStatus).HasColumnName("from_status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.ToStatus).HasColumnName("to_status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.ActorId).HasColumnName("actor_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Reason).HasColumnName("reason").HasMaxLength(256);
        builder.Property(x => x.OccurredAt).HasColumnName("occurred_at");
        builder.HasIndex(x => x.AssetId).HasDatabaseName("ix_asset_lifecycle_entries_asset_id");
    }
}
