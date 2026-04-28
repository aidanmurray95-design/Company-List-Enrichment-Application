using System.Net.Http.Headers;

namespace BlueFlameIngest;

// Posts a file to the Vercel /api/ingest endpoint. The endpoint expects raw
// bytes in the body and the original filename in the X-File-Name header.
//
// On Hobby tier the function body is capped at ~4.5 MB. We surface that as a
// distinct exception so callers can produce a clear reject reason.
public sealed class CloudUploader : IDisposable
{
    private readonly HttpClient _http;
    private readonly CloudConfig _cfg;
    private readonly ILogger<CloudUploader> _log;

    public CloudUploader(IngestConfig cfg, ILogger<CloudUploader> log)
    {
        _cfg = cfg.Cloud;
        _log = log;
        _http = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(_cfg.HttpTimeoutSeconds)
        };
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_cfg.IngestUrl) &&
        !string.IsNullOrWhiteSpace(_cfg.IngestToken) &&
        !_cfg.IngestToken!.StartsWith("REPLACE_", StringComparison.Ordinal);

    public async Task UploadAsync(string fileName, byte[] contents, CancellationToken ct)
    {
        if (!IsConfigured)
            throw new InvalidOperationException(
                "Cloud mode is enabled but cloud.ingestUrl / cloud.ingestToken are not set in config.json.");

        using var content = new ByteArrayContent(contents);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");

        using var req = new HttpRequestMessage(HttpMethod.Post, _cfg.IngestUrl)
        {
            Content = content
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _cfg.IngestToken);
        req.Headers.TryAddWithoutValidation("X-File-Name", fileName);

        using var resp = await _http.SendAsync(req, ct);
        if (resp.IsSuccessStatusCode)
        {
            _log.LogInformation("Cloud upload OK: {Name} ({Bytes}B)", fileName, contents.Length);
            return;
        }

        var body = await resp.Content.ReadAsStringAsync(ct);
        // Vercel returns 413 Payload Too Large for body-cap violations; some
        // environments return a 400 with a helpful message instead.
        if ((int)resp.StatusCode == 413)
            throw new HttpRequestException(
                $"file exceeds Vercel function body cap (~4.5 MB on Hobby, ~32 MB on Pro): {body}");

        throw new HttpRequestException(
            $"upload failed: HTTP {(int)resp.StatusCode} {resp.ReasonPhrase} — {body}");
    }

    public void Dispose() => _http.Dispose();
}
