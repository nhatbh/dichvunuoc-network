using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DesignProjectConfiguration : IEntityTypeConfiguration<DesignProjectPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DesignProjectPersistenceModel> builder)
    {
        builder.ToTable("design_projects");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(x => x.BranchId).HasColumnName("branch_id").HasMaxLength(64);
        builder.Property(x => x.ZoneId).HasColumnName("zone_id").HasMaxLength(64);
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.Name })
            .IsUnique().HasDatabaseName("ux_design_projects_tenant_name");
    }
}
