using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterPlatform.BuildingBlocks.Infrastructure.Outbox;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence.Configurations;

internal sealed class OutboxConfiguration : IEntityTypeConfiguration<OutboxEntry>
{
    public void Configure(EntityTypeBuilder<OutboxEntry> builder)
    {
        builder.ToTable("outbox_entries");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id)
            .IsRequired();

        builder.Property(e => e.AggregateId)
            .IsRequired();

        builder.Property(e => e.AggregateType)
            .IsRequired();

        builder.Property(e => e.EventType)
            .IsRequired();

        builder.Property(e => e.Payload)
            .IsRequired();

        builder.Property(e => e.Status)
            .IsRequired()
            .HasConversion<string>();

        builder.Property(e => e.CreatedAt)
            .IsRequired();

        builder.Property(e => e.LastError);

        builder.Property(e => e.TenantId);

        builder.HasIndex(e => new { e.Status, e.CreatedAt });
        builder.HasIndex(e => e.AggregateId);
    }
}
