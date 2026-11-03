using WaterNetwork.GisBff.Endpoints;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyHeader().AllowAnyMethod().SetIsOriginAllowed(_ => true)));
builder.Services.AddSingleton<WaterNetwork.GisBff.Seed.SeedStore>();
builder.Services.AddSingleton<WaterNetwork.GisBff.Seed.FullStore>();

var app = builder.Build();
app.UseCors();
app.MapHealthChecks("/health");
Health.Map(app);
Dashboard.Map(app);
Layers.Map(app);
Network.Map(app);
Full.Map(app);
app.Run();

public partial class Program { }
