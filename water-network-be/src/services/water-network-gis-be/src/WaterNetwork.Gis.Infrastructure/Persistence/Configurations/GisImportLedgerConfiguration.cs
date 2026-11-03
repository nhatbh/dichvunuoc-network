using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class GisImportLedgerConfiguration : IEntityTypeConfiguration<GisImportLedgerPersistenceModel>
{
    public void Configure(EntityTypeBuilder<GisImportLedgerPersistenceModel> builder)
    {
        builder.ToTable("gis_import_ledger");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.RevisionId).HasColumnName("revision_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DraftAssetId).HasColumnName("draft_asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.GisAssetId).HasColumnName("gis_asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Kind).HasColumnName("kind").HasMaxLength(16).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");

        builder.HasIndex(x => new { x.RevisionId, x.DraftAssetId })
            .IsUnique().HasDatabaseName("ux_gis_import_ledger_revision_draft");
    }
}
