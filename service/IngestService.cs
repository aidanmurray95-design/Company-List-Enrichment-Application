using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;

namespace BlueFlameIngest;

public sealed class IngestService : BackgroundService
{
    private readonly IngestConfig _cfg;
    private readonly WebSocketHub _hub;
    private readonly CloudUploader _cloud;
    private readonly ILogger<IngestService> _log;
    private readonly Channel<string> _queue = Channel.CreateUnbounded<string>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
    private readonly ConcurrentDictionary<string, DateTime> _pending = new();
    private readonly Regex? _filenameRegex;
    private FileSystemWatcher? _watcher;
    private HashSet<string> _seenHashes = new();
    private readonly object _hashLock = new();
    private bool CloudMode => string.Equals(_cfg.Mode, "cloud", StringComparison.OrdinalIgnoreCase);

    public IngestService(IngestConfig cfg, WebSocketHub hub, CloudUploader cloud, ILogger<IngestService> log)
    {
        _cfg = cfg;
        _hub = hub;
        _cloud = cloud;
        _log = log;
        _filenameRegex = string.IsNullOrWhiteSpace(_cfg.Gates.FilenamePattern)
            ? null
            : new Regex(_cfg.Gates.FilenamePattern, RegexOptions.IgnoreCase | RegexOptions.Compiled);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        EnsureFolders();
        LoadDedupeStore();

        _watcher = new FileSystemWatcher(_cfg.WatchFolder)
        {
            IncludeSubdirectories = false,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            EnableRaisingEvents = true
        };
        _watcher.Created += (_, e) => Enqueue(e.FullPath);
        _watcher.Renamed += (_, e) => Enqueue(e.FullPath);
        _watcher.Changed += (_, e) => Enqueue(e.FullPath);
        _watcher.Error += (_, e) => _log.LogError(e.GetException(), "FileSystemWatcher error");

        _log.LogInformation("Watching {Folder} | mode={Mode}{CloudUrl}",
            _cfg.WatchFolder,
            CloudMode ? "cloud" : "ws",
            CloudMode ? $" → {_cfg.Cloud.IngestUrl}" : "");

        if (CloudMode && !_cloud.IsConfigured)
            _log.LogWarning("Cloud mode is selected but cloud.ingestUrl / cloud.ingestToken are missing — every file will be rejected.");

        // Pick up files already sitting in the inbox at start
        foreach (var path in Directory.EnumerateFiles(_cfg.WatchFolder))
            Enqueue(path);

        await foreach (var path in _queue.Reader.ReadAllAsync(ct))
        {
            try
            {
                await ProcessAsync(path, ct);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Error processing {Path}", path);
                await RejectAsync(path, $"unhandled: {ex.Message}", ct);
            }
        }
    }

    private async Task RejectAsync(string path, string reason, CancellationToken ct)
    {
        long size = 0;
        try { size = new FileInfo(path).Length; } catch { /* file may already be moved */ }
        var name = Path.GetFileName(path);
        SafeMove(path, _cfg.RejectedFolder, reason);
        if (_hub.ClientCount > 0)
        {
            try { await _hub.BroadcastRejectAsync(name, size, reason, ct); }
            catch (Exception ex) { _log.LogWarning(ex, "Failed to broadcast reject for {Name}", name); }
        }
    }

    private void Enqueue(string path)
    {
        // Coalesce rapid-fire watcher events for the same file
        var now = DateTime.UtcNow;
        _pending[path] = now;
        _ = Task.Run(async () =>
        {
            await Task.Delay(_cfg.FileSettleMs);
            if (_pending.TryGetValue(path, out var ts) && ts == now)
            {
                _pending.TryRemove(path, out _);
                await _queue.Writer.WriteAsync(path);
            }
        });
    }

    private async Task ProcessAsync(string path, CancellationToken ct)
    {
        if (!File.Exists(path)) return;

        // Wait until the writer has released the file
        if (!await WaitForUnlockedAsync(path, ct))
        {
            _log.LogWarning("File {Path} stayed locked too long; skipping", path);
            await RejectAsync(path, "file remained locked", ct);
            return;
        }

        var info = new FileInfo(path);
        var ext = info.Extension.ToLowerInvariant();
        var name = info.Name;

        // ── Gate 1: extension ──
        if (!_cfg.Gates.Extensions.Any(e => string.Equals(e, ext, StringComparison.OrdinalIgnoreCase)))
        {
            _log.LogInformation("Reject {Name}: extension {Ext} not allowed", name, ext);
            await RejectAsync(path, $"extension {ext} not in allow-list", ct);
            return;
        }

        // ── Gate 2: size ──
        if (info.Length < _cfg.Gates.MinBytes || info.Length > _cfg.Gates.MaxBytes)
        {
            _log.LogInformation("Reject {Name}: size {Size}B out of range", name, info.Length);
            await RejectAsync(path,
                $"size {info.Length} out of range [{_cfg.Gates.MinBytes}, {_cfg.Gates.MaxBytes}]", ct);
            return;
        }

        // ── Gate 3: age ──
        if (_cfg.Gates.MaxAgeMinutes is int maxAge)
        {
            var ageMin = (DateTime.UtcNow - info.LastWriteTimeUtc).TotalMinutes;
            if (ageMin > maxAge)
            {
                _log.LogInformation("Reject {Name}: age {Age}min exceeds {Max}", name, ageMin, maxAge);
                await RejectAsync(path, $"age {ageMin:F1}min exceeds max {maxAge}", ct);
                return;
            }
        }

        // ── Gate 4: filename pattern ──
        if (_filenameRegex is not null && !_filenameRegex.IsMatch(name))
        {
            _log.LogInformation("Reject {Name}: does not match pattern", name);
            await RejectAsync(path, $"does not match pattern {_cfg.Gates.FilenamePattern}", ct);
            return;
        }

        // Read contents
        byte[] bytes;
        try
        {
            bytes = await File.ReadAllBytesAsync(path, ct);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to read {Path}", path);
            await RejectAsync(path, $"read failed: {ex.Message}", ct);
            return;
        }

        // ── Gate 5: dedupe by hash ──
        if (_cfg.Gates.DedupeByHash)
        {
            var hash = Convert.ToHexString(SHA256.HashData(bytes));
            bool seen;
            lock (_hashLock) seen = _seenHashes.Contains(hash);
            if (seen)
            {
                _log.LogInformation("Skip {Name}: duplicate hash {Hash}", name, hash[..12]);
                SafeMove(path, _cfg.ProcessedFolder, null); // treat as already-processed
                return;
            }
            lock (_hashLock)
            {
                _seenHashes.Add(hash);
                PersistDedupeStore();
            }
        }

        if (CloudMode)
        {
            try
            {
                await _cloud.UploadAsync(name, bytes, ct);
                SafeMove(path, _cfg.ProcessedFolder, null);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Cloud upload failed for {Name}", name);
                await RejectAsync(path, $"cloud upload failed: {ex.Message}", ct);
            }
            return;
        }

        // ── ws mode ──
        if (_hub.ClientCount == 0)
        {
            _log.LogWarning("No browser connected — leaving {Name} in inbox to retry", name);
            // Re-queue so we don't lose it; small backoff via settle delay
            _ = Task.Run(async () => { await Task.Delay(2000, ct); Enqueue(path); }, ct);
            return;
        }

        await _hub.BroadcastFileAsync(name, bytes, ct);
        _log.LogInformation("Sent {Name} ({Size}B) to {Clients} client(s)", name, bytes.Length, _hub.ClientCount);
        SafeMove(path, _cfg.ProcessedFolder, null);
    }

    private async Task<bool> WaitForUnlockedAsync(string path, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow.AddSeconds(_cfg.MaxLockWaitSeconds);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using var fs = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                return true;
            }
            catch (IOException)
            {
                await Task.Delay(250, ct);
            }
        }
        return false;
    }

    private void EnsureFolders()
    {
        Directory.CreateDirectory(_cfg.WatchFolder);
        Directory.CreateDirectory(_cfg.ProcessedFolder);
        Directory.CreateDirectory(_cfg.RejectedFolder);
    }

    private void SafeMove(string sourcePath, string destFolder, string? reason)
    {
        try
        {
            if (!File.Exists(sourcePath)) return;
            Directory.CreateDirectory(destFolder);
            var destPath = UniquePath(Path.Combine(destFolder, Path.GetFileName(sourcePath)));
            File.Move(sourcePath, destPath);
            if (reason is not null)
            {
                File.WriteAllText(destPath + ".reason.txt",
                    $"{DateTime.UtcNow:O}\n{reason}\n");
            }
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to move {Source} to {Dest}", sourcePath, destFolder);
        }
    }

    private static string UniquePath(string path)
    {
        if (!File.Exists(path)) return path;
        var dir = Path.GetDirectoryName(path)!;
        var stem = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);
        for (int i = 1; i < 1000; i++)
        {
            var candidate = Path.Combine(dir, $"{stem} ({i}){ext}");
            if (!File.Exists(candidate)) return candidate;
        }
        return Path.Combine(dir, $"{stem} ({Guid.NewGuid():N}){ext}");
    }

    private void LoadDedupeStore()
    {
        try
        {
            if (!File.Exists(_cfg.DedupeStorePath)) return;
            var json = File.ReadAllText(_cfg.DedupeStorePath);
            var hashes = JsonSerializer.Deserialize<List<string>>(json);
            if (hashes is not null) _seenHashes = new HashSet<string>(hashes, StringComparer.OrdinalIgnoreCase);
            _log.LogInformation("Loaded {Count} hashes from dedupe store", _seenHashes.Count);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not load dedupe store; starting empty");
        }
    }

    private void PersistDedupeStore()
    {
        try
        {
            // Cap at most-recent 1000 to avoid unbounded growth
            var capped = _seenHashes.Count > 1000
                ? _seenHashes.Skip(_seenHashes.Count - 1000).ToList()
                : _seenHashes.ToList();
            File.WriteAllText(_cfg.DedupeStorePath, JsonSerializer.Serialize(capped));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not persist dedupe store");
        }
    }

    public override void Dispose()
    {
        _watcher?.Dispose();
        base.Dispose();
    }
}
