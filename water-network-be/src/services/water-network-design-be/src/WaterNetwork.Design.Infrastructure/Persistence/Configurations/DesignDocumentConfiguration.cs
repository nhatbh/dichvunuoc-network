using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignDocumentConfiguration : IEntityTypeConfiguration<DesignDocumentPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignDocumentPersistenceModel> builder)
    {
        builder.ToTable("design_documents");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.ProjectId).HasColumnName("project_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.FileName).HasColumnName("file_name").HasMaxLength(512).IsRequired();
        builder.Property(x => x.ContentType).HasColumnName("content_type").HasMaxLength(128).IsRequired();
        builder.Property(x => x.SizeBytes).HasColumnName("size_bytes");
        builder.Property(x => x.FileRef).HasColumnName("file_ref").HasMaxLength(1024).IsRequired();
        builder.Property(x => x.DocumentType).HasColumnName("document_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.UploadedBy).HasColumnName("uploaded_by").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => x.ProjectId).HasDatabaseName("ix_design_documents_project");
    }
}
