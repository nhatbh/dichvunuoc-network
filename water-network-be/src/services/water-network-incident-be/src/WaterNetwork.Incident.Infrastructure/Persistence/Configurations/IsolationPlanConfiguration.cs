using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using WaterNetwork.Incident.Infrastructure.Persistence.Models;

namespace WaterNetwork.Incident.Infrastructure.Persistence.Configurations;

public sealed class IsolationPlanConfiguration : IEntityTypeConfiguration<IsolationPlanModel>
{
    public void Configure(EntityTypeBuilder<IsolationPlanModel> builder)
    {
        builder.ToTable("isolation_plans");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").HasMaxLength(64);
        builder.Property(x => x.IncidentId).HasColumnName("incident_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.TenantId).HasColumnName("tenant_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.StartNodeId).HasColumnName("start_node_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
        builder.Property(x => x.GraphVersion).HasColumnName("graph_version");
        builder.Property(x => x.ValvesToClose).HasColumnName("valves_to_close").HasColumnType("text[]");
        builder.Property(x => x.IsolatedNodes).HasColumnName("isolated_nodes").HasColumnType("text[]");
        builder.Property(x => x.IsolatedPipes).HasColumnName("isolated_pipes").HasColumnType("text[]");
        builder.Property(x => x.FailureReason).HasColumnName("failure_reason").HasMaxLength(1000);
        builder.Property(x => x.ComputedAt).HasColumnName("computed_at");
        builder.Property(x => x.Sequence).HasColumnName("sequence");
        builder.HasIndex(x => new { x.TenantId, x.IncidentId }).HasDatabaseName("ix_isolation_plans_tenant_incident");
    }
}
