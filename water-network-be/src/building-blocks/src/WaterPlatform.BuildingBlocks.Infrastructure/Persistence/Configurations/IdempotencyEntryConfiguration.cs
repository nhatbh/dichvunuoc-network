using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence.Configurations;

internal sealed class IdempotencyEntryConfiguration : IEntityTypeConfiguration<IdempotencyEntry>
{
    public void Configure(EntityTypeBuilder<IdempotencyEntry> builder)
    {
        builder.ToTable("idempotency_entries");
        builder.HasKey(e => e.Key);
        builder.Property(e => e.Key).HasMaxLength(256).IsRequired();
        builder.Property(e => e.Result).HasColumnType("text");
        builder.HasIndex(e => e.ProcessedAt);
    }
}
