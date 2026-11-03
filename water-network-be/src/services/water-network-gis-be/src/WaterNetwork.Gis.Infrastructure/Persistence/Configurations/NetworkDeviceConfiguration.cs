using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class NetworkDeviceConfiguration : IEntityTypeConfiguration<NetworkDevicePersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkDevicePersistenceModel> builder)
    {
        builder.ToTable("network_devices");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DeviceType).HasColumnName("device_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.HostPipeId).HasColumnName("host_pipe_id").HasMaxLength(64);
        builder.Property(x => x.HostNodeId).HasColumnName("host_node_id").HasMaxLength(64);
        builder.Property(x => x.Location).HasColumnName("location").HasColumnType("geometry(Point,4326)").IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("Active").IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");

        builder.HasIndex(x => new { x.TenantId, x.AssetCode }).IsUnique().HasDatabaseName("ux_network_devices_tenant_asset_code");
        builder.HasIndex(x => x.Location).HasMethod("gist").HasDatabaseName("ix_network_devices_location_gist");
        builder.HasIndex(x => new { x.TenantId, x.HostPipeId })
            .HasDatabaseName("ix_network_devices_host_pipe")
            .HasFilter("host_pipe_id IS NOT NULL");
        builder.HasIndex(x => new { x.TenantId, x.HostNodeId })
            .HasDatabaseName("ix_network_devices_host_node")
            .HasFilter("host_node_id IS NOT NULL");
        builder.HasQueryFilter(x => x.DeletedAt == null);
    }
}
