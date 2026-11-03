using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class NetworkPipeConfiguration : IEntityTypeConfiguration<NetworkPipePersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkPipePersistenceModel> builder)
    {
        builder.ToTable("network_pipes");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.FromNodeId).HasColumnName("from_node_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.ToNodeId).HasColumnName("to_node_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Geometry).HasColumnName("geometry").HasColumnType("geometry(LineString,4326)").IsRequired();
        builder.Property(x => x.DiameterMm).HasColumnName("diameter_mm").IsRequired();
        builder.Property(x => x.Material).HasColumnName("material").HasMaxLength(64).IsRequired();
        builder.Property(x => x.LengthM).HasColumnName("length_m").IsRequired();
        builder.Property(x => x.LengthValidationWarning).HasColumnName("length_validation_warning");
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("Active").IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");

        builder.HasIndex(x => new { x.TenantId, x.AssetCode }).IsUnique().HasDatabaseName("ux_network_pipes_tenant_asset_code");
        builder.HasIndex(x => x.Geometry).HasMethod("gist").HasDatabaseName("ix_network_pipes_geometry_gist");
        builder.HasIndex(x => new { x.TenantId, x.FromNodeId, x.ToNodeId }).HasDatabaseName("ix_network_pipes_from_to");
        builder.HasQueryFilter(x => x.DeletedAt == null);
    }
}
