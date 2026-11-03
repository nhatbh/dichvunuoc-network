using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;

public sealed class GeometryVersionConfiguration : IEntityTypeConfiguration<GeometryVersionPersistenceModel>
{
    public void Configure(EntityTypeBuilder<GeometryVersionPersistenceModel> builder)
    {
        builder.ToTable("geometry_versions");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.AssetKind).HasColumnName("asset_kind").HasMaxLength(16).IsRequired();
        builder.Property(x => x.Version).HasColumnName("version").IsRequired();
        builder.Property(x => x.Geometry).HasColumnName("geometry").HasColumnType("geometry(Geometry,4326)");
        builder.Property(x => x.GeoJson).HasColumnName("geojson").IsRequired();
        builder.Property(x => x.ChangedBy).HasColumnName("changed_by").HasMaxLength(64);
        builder.Property(x => x.Reason).HasColumnName("reason");
        builder.Property(x => x.ChangedAt).HasColumnName("changed_at").IsRequired();

        // Unique btree index enforces one geometry state per (asset, version).
        // Also serves as the fast lookup index for ListByAsset queries.
        builder.HasIndex(x => new { x.AssetId, x.Version })
            .IsUnique()
            .HasDatabaseName("ux_geometry_versions_asset_version");

        // No HasQueryFilter: append-only, no soft-delete.
    }
}
