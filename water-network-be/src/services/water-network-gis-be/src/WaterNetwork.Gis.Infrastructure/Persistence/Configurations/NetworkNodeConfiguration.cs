using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class NetworkNodeConfiguration : IEntityTypeConfiguration<NetworkNodePersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkNodePersistenceModel> builder)
    {
        builder.ToTable("network_nodes");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.NodeType).HasColumnName("node_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.Location).HasColumnName("location").HasColumnType("geometry(Point,4326)").IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");

        builder.HasIndex(x => new { x.TenantId, x.AssetCode }).IsUnique().HasDatabaseName("ux_network_nodes_tenant_asset_code");
        builder.HasIndex(x => x.Location).HasMethod("gist").HasDatabaseName("ix_network_nodes_location_gist");
        builder.HasQueryFilter(x => x.DeletedAt == null);
    }
}
