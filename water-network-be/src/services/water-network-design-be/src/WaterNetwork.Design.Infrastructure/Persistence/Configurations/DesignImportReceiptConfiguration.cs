using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignImportReceiptConfiguration : IEntityTypeConfiguration<DesignImportReceiptPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignImportReceiptPersistenceModel> builder)
    {
        builder.ToTable("design_import_receipts");
        builder.HasKey(x => new { x.TenantId, x.ImportKey });
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64);
        builder.Property(x => x.ImportKey).HasColumnName("import_key").HasMaxLength(160);
        builder.Property(x => x.PayloadSha256).HasColumnName("payload_sha256").HasMaxLength(64).IsRequired();
        builder.Property(x => x.ProjectId).HasColumnName("project_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.RevisionId).HasColumnName("revision_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetCount).HasColumnName("asset_count");
        builder.Property(x => x.ProvenanceJson).HasColumnName("provenance").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.HasOne<DesignProjectPersistenceModel>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<DesignRevisionPersistenceModel>().WithMany().HasForeignKey(x => x.RevisionId).OnDelete(DeleteBehavior.Restrict);
    }
}
