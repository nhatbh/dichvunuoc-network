using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WaterPlatform.BuildingBlocks.Infrastructure.Persistence;

public sealed class ProcessedEventEntry
{
    public string Id { get; set; } = default!;
    public string ProjectionName { get; set; } = default!;
    public string EventId { get; set; } = default!;
    public DateTime ProcessedAt { get; set; }
}

internal sealed class ProcessedEventEntryConfiguration : IEntityTypeConfiguration<ProcessedEventEntry>
{
    public void Configure(EntityTypeBuilder<ProcessedEventEntry> builder)
    {
        builder.ToTable("processed_events");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasMaxLength(256);
        builder.Property(e => e.ProjectionName).HasMaxLength(200).IsRequired();
        builder.Property(e => e.EventId).HasMaxLength(256).IsRequired();
        builder.HasIndex(e => new { e.ProjectionName, e.EventId }).IsUnique();
        builder.HasIndex(e => e.ProcessedAt);
    }
}
