using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterNetwork.Asset.Infrastructure.Persistence.Configurations;

public sealed class AssetTechnicalProfileConfiguration : IEntityTypeConfiguration<AssetTechnicalProfilePersistenceModel>
{
    public void Configure(EntityTypeBuilder<AssetTechnicalProfilePersistenceModel> builder)
    {
        builder.ToTable("asset_technical_profiles");
        builder.HasKey(x => x.AssetId);
        builder.Property(x => x.AssetId).HasColumnName("asset_id").HasMaxLength(64);
        builder.Property(x => x.InstallationYear).HasColumnName("installation_year");
        builder.Property(x => x.Manufacturer).HasColumnName("manufacturer").HasMaxLength(128);
        builder.Property(x => x.Model).HasColumnName("model").HasMaxLength(128);
        builder.Property(x => x.AttributesJson).HasColumnName("attributes").HasColumnType("jsonb").IsRequired();
    }
}
