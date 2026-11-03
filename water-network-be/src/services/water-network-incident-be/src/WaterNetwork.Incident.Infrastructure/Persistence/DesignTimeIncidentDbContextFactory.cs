using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WaterNetwork.Incident.Infrastructure.Persistence;

public sealed class DesignTimeIncidentDbContextFactory : IDesignTimeDbContextFactory<IncidentDbContext>
{
    public IncidentDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<IncidentDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=wn_incident;Username=postgres;Password=postgres",
                o => o.UseNetTopologySuite())
            .Options;
        return new IncidentDbContext(options);
    }
}
