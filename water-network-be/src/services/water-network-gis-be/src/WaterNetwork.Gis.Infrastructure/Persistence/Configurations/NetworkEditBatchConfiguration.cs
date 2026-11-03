using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace WaterNetwork.Gis.Infrastructure.Persistence.Configurations;
public sealed class NetworkEditBatchConfiguration : IEntityTypeConfiguration<NetworkEditBatchPersistenceModel>
{
    public void Configure(EntityTypeBuilder<NetworkEditBatchPersistenceModel> builder)
    {
        builder.ToTable("network_edit_batches"); builder.HasKey(x=>new{x.TenantId,x.RevisionId});
        builder.Property(x=>x.RevisionId).HasColumnName("revision_id").HasMaxLength(64);
        builder.Property(x=>x.TenantId).HasColumnName("tenant_id").HasMaxLength(64);
        builder.Property(x=>x.Status).HasColumnName("status").HasMaxLength(32);
        builder.Property(x=>x.CompletedAt).HasColumnName("completed_at");
    }
}
