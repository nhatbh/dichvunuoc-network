using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace WaterNetwork.Design.Infrastructure.Persistence;

public sealed class DesignTimeDesignDbContextFactory : IDesignTimeDbContextFactory<DesignDbContext>
{
    public DesignDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<DesignDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=wn_design;Username=postgres;Password=postgres",
                o => o.UseNetTopologySuite())
            .Options;
        return new DesignDbContext(options);
    }
}
