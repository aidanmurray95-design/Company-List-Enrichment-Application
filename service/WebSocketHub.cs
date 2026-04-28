using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace BlueFlameIngest;

public sealed class WebSocketHub
{
    private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();
    private readonly ILogger<WebSocketHub> _log;

    public WebSocketHub(ILogger<WebSocketHub> log) => _log = log;

    public int ClientCount => _clients.Count;

    public async Task HandleAsync(WebSocket socket, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        _clients[id] = socket;
        _log.LogInformation("Browser connected ({Id}). Total clients: {Count}", id, _clients.Count);

        var buf = new byte[1024];
        try
        {
            while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buf, ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", ct);
                    break;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "WebSocket error for client {Id}", id);
        }
        finally
        {
            _clients.TryRemove(id, out _);
            _log.LogInformation("Browser disconnected ({Id}). Total clients: {Count}", id, _clients.Count);
        }
    }

    public Task BroadcastFileAsync(string fileName, byte[] contents, CancellationToken ct) =>
        BroadcastAsync(new
        {
            type = "file",
            name = fileName,
            sizeBytes = contents.Length,
            timestamp = DateTime.UtcNow.ToString("O"),
            contentBase64 = Convert.ToBase64String(contents)
        }, ct);

    public Task BroadcastRejectAsync(string fileName, long sizeBytes, string reason, CancellationToken ct) =>
        BroadcastAsync(new
        {
            type = "reject",
            name = fileName,
            sizeBytes,
            reason,
            timestamp = DateTime.UtcNow.ToString("O")
        }, ct);

    private async Task BroadcastAsync(object payload, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(payload);
        var bytes = Encoding.UTF8.GetBytes(json);
        var seg = new ArraySegment<byte>(bytes);

        var dead = new List<Guid>();
        foreach (var (id, socket) in _clients)
        {
            try
            {
                if (socket.State == WebSocketState.Open)
                    await socket.SendAsync(seg, WebSocketMessageType.Text, endOfMessage: true, ct);
                else
                    dead.Add(id);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Failed to send to client {Id}", id);
                dead.Add(id);
            }
        }
        foreach (var id in dead) _clients.TryRemove(id, out _);
    }
}
