using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignImportResultConfiguration : IEntityTypeConfiguration<DesignImportResultPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignImportResultPersistenceModel> builder)
    {
        builder.ToTable("design_import_results");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.RevisionId).HasColumnName("revision_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DraftAssetId).HasColumnName("draft_asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.GisAssetId).HasColumnName("gis_asset_id").HasMaxLength(64);
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
        builder.Property(x => x.Reason).HasColumnName("reason");
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");

        builder.HasIndex(x => new { x.TenantId, x.RevisionId }).HasDatabaseName("ix_design_import_results_tenant_revision");
        builder.HasIndex(x => new { x.RevisionId, x.DraftAssetId })
            .IsUnique().HasDatabaseName("ux_design_import_results_revision_draft");
    }
}
