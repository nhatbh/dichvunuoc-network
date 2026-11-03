using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WaterNetwork.Gis.Infrastructure.Persistence;

public sealed class DesignTimeGisDbContextFactory : IDesignTimeDbContextFactory<GisDbContext>
{
    public GisDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<GisDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=wn_gis;Username=postgres;Password=postgres",
                o => o.UseNetTopologySuite())
            .Options;
        return new GisDbContext(options);
    }
}
