using System.Net.WebSockets;
using BlueFlameIngest;

var exeDir = AppContext.BaseDirectory;
var configPath = Path.Combine(exeDir, "config.json");
var examplePath = Path.Combine(exeDir, "config.example.json");

// Bootstrap from the template on first run. The real config holds the cloud
// ingest token and is gitignored, so a fresh checkout starts with placeholders.
if (!File.Exists(configPath) && File.Exists(examplePath))
{
    File.Copy(examplePath, configPath);
    Console.WriteLine($"Created {configPath} from config.example.json — edit it before enabling cloud mode.");
}

var cfg = IngestConfig.Load(configPath);

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService(o => o.ServiceName = "BlueFlameIngest");

builder.WebHost.ConfigureKestrel(opts =>
{
    // Localhost only — never bind to 0.0.0.0
    opts.ListenLocalhost(cfg.WebSocketPort);
});

builder.Services.AddSingleton(cfg);
builder.Services.AddSingleton<WebSocketHub>();
builder.Services.AddSingleton<CloudUploader>();
builder.Services.AddHostedService<IngestService>();

var app = builder.Build();

app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(30)
});

app.MapGet("/health", (WebSocketHub hub) => Results.Ok(new
{
    status = "ok",
    clients = hub.ClientCount,
    watching = cfg.WatchFolder
}));

app.Map("/ws", async (HttpContext ctx, WebSocketHub hub) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }
    using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
    await hub.HandleAsync(socket, ctx.RequestAborted);
});

app.Run();
