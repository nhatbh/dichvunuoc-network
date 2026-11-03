using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignRevisionConfiguration : IEntityTypeConfiguration<DesignRevisionPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignRevisionPersistenceModel> builder)
    {
        builder.ToTable("design_revisions");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.ProjectId).HasColumnName("project_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.RevisionNumber).HasColumnName("revision_number").IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.ValidationResultJson).HasColumnName("validation_result").HasColumnType("jsonb");
        builder.Property(x => x.NetworkEditsJson).HasColumnName("network_edits").HasColumnType("jsonb");
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.ProjectId, x.RevisionNumber })
            .IsUnique().HasDatabaseName("ux_design_revisions_tenant_project_number");
        builder.HasIndex(x => new { x.TenantId, x.ProjectId }).HasDatabaseName("ix_design_revisions_tenant_project");

        builder.HasOne<DesignProjectPersistenceModel>()
            .WithMany()
            .HasForeignKey(x => x.ProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(x => x.Transitions)
            .WithOne()
            .HasForeignKey(x => x.RevisionId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
