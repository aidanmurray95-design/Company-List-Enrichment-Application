using System.Text.Json;
using System.Text.Json.Serialization;

namespace BlueFlameIngest;

public sealed class IngestConfig
{
    public string WatchFolder { get; set; } = @"C:\BlueFlameInbox";
    public string ProcessedFolder { get; set; } = @"C:\BlueFlameInbox\processed";
    public string RejectedFolder { get; set; } = @"C:\BlueFlameInbox\rejected";
    public string DedupeStorePath { get; set; } = @"C:\BlueFlameInbox\.dedupe.json";
    public int WebSocketPort { get; set; } = 7321;
    public int FileSettleMs { get; set; } = 750;
    public int MaxLockWaitSeconds { get; set; } = 30;
    public Gates Gates { get; set; } = new();

    // "ws" = local WebSocket bridge (default; browser must be opened locally).
    // "cloud" = POST each accepted file to the Vercel /api/ingest endpoint
    //           so the deployed app picks it up by polling.
    public string Mode { get; set; } = "ws";

    public CloudConfig Cloud { get; set; } = new();

    public static IngestConfig Load(string path)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException($"config.json not found at {path}");

        var json = File.ReadAllText(path);
        var opts = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true
        };
        var cfg = JsonSerializer.Deserialize<IngestConfig>(json, opts)
                  ?? throw new InvalidOperationException("Failed to parse config.json");
        return cfg;
    }
}

public sealed class CloudConfig
{
    // e.g. "https://your-app.vercel.app/api/ingest"
    public string? IngestUrl { get; set; }

    // Bearer token, must match Vercel env var INGEST_TOKEN.
    public string? IngestToken { get; set; }

    // POST timeout. Files are tens of KB to a few MB; 60s is plenty.
    public int HttpTimeoutSeconds { get; set; } = 60;
}

public sealed class Gates
{
    public string[] Extensions { get; set; } = new[] { ".xlsx", ".xls", ".csv" };

    [JsonPropertyName("filenamePattern")]
    public string? FilenamePattern { get; set; }

    public long MinBytes { get; set; } = 100;
    public long MaxBytes { get; set; } = 26_214_400;
    public int? MaxAgeMinutes { get; set; }
    public bool DedupeByHash { get; set; } = true;
}
