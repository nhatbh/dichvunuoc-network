using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Design.Infrastructure.Persistence;

namespace WaterNetwork.Design.Infrastructure.Persistence.Configurations;

public sealed class DraftNetworkAssetConfiguration : IEntityTypeConfiguration<DraftNetworkAssetPersistenceModel>
{
    public void Configure(EntityTypeBuilder<DraftNetworkAssetPersistenceModel> builder)
    {
        builder.ToTable("draft_network_assets");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.RevisionId).HasColumnName("revision_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.DraftKind).HasColumnName("draft_kind").HasMaxLength(16).IsRequired();
        builder.Property(x => x.AssetCode).HasColumnName("asset_code").HasMaxLength(64).IsRequired();
        builder.Property(x => x.ClientRef).HasColumnName("client_ref").HasMaxLength(128);
        // Generic geometry column — holds Point (node/device) or LineString (pipe).
        builder.Property(x => x.Geometry).HasColumnName("geometry").HasColumnType("geometry(Geometry,4326)").IsRequired();
        builder.Property(x => x.AttributesJson).HasColumnName("attributes").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.FromRef).HasColumnName("from_ref").HasMaxLength(128);
        builder.Property(x => x.ToRef).HasColumnName("to_ref").HasMaxLength(128);
        builder.Property(x => x.HostRef).HasColumnName("host_ref").HasMaxLength(128);
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.UpdatedAt).HasColumnName("updated_at");

        builder.HasIndex(x => new { x.TenantId, x.RevisionId }).HasDatabaseName("ix_draft_assets_tenant_revision");
        builder.HasIndex(x => new { x.RevisionId, x.AssetCode }).HasDatabaseName("ix_draft_assets_revision_code");

        builder.HasOne<DesignRevisionPersistenceModel>()
            .WithMany()
            .HasForeignKey(x => x.RevisionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
