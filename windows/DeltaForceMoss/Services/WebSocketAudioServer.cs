using System;
using System.Collections.Generic;
using System.Net;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using System.Text;
using System.Threading.Channels;

namespace DeltaForceMoss.Services
{
    /// <summary>
    /// 免弹窗系统声音 WebSocket 本地广播服务 (ws://127.0.0.1:9999/audio)
    /// </summary>
    public class WebSocketAudioServer : IDisposable
    {
        private HttpListener? _httpListener;
        private sealed class Client
        {
            public WebSocket Socket { get; }
            public Channel<byte[]> Audio { get; } = Channel.CreateBounded<byte[]>(32);
            public Client(WebSocket socket) => Socket = socket;
        }
        private readonly List<Client> _clients = new();
        public int SampleRate { get; set; } = 48000;
        private readonly object _lock = new();
        private bool _isRunning;

        public event Action<string>? OnLog;

        public void Start(int port = 9999)
        {
            if (_isRunning) return;

            try
            {
                _httpListener = new HttpListener();
                _httpListener.Prefixes.Add($"http://127.0.0.1:{port}/audio/");
                _httpListener.Start();
                _isRunning = true;

                OnLog?.Invoke($"WebSocket 全局音频桥接已开启: ws://127.0.0.1:{port}/audio/");

                Task.Run(ListenLoop);
            }
            catch (Exception ex)
            {
                OnLog?.Invoke($"WebSocket 开启失败: {ex.Message}");
            }
        }

        private async Task ListenLoop()
        {
            while (_isRunning && _httpListener != null && _httpListener.IsListening)
            {
                try
                {
                    var context = await _httpListener.GetContextAsync();
                    if (context.Request.IsWebSocketRequest)
                    {
                        ProcessWebSocketRequest(context);
                    }
                    else
                    {
                        context.Response.StatusCode = 400;
                        context.Response.Close();
                    }
                }
                catch
                {
                    if (!_isRunning) break;
                }
            }
        }

        private async void ProcessWebSocketRequest(HttpListenerContext context)
        {
            Client? client = null;
            WebSocket? ws = null;
            Task? sending = null;
            try
            {
                var wsContext = await context.AcceptWebSocketAsync(null);
                ws = wsContext.WebSocket;

                var metadata = Encoding.UTF8.GetBytes($"{{\"type\":\"audio-format\",\"encoding\":\"float32\",\"channels\":1,\"sampleRate\":{SampleRate}}}");
                await ws.SendAsync(new ArraySegment<byte>(metadata), WebSocketMessageType.Text, true, CancellationToken.None);
                client = new Client(ws);
                lock (_lock) _clients.Add(client);
                sending = SendAudio(client);
                OnLog?.Invoke("网页前端已成功接入免弹窗音频流");

                byte[] buffer = new byte[1024];
                while (ws.State == WebSocketState.Open && _isRunning)
                {
                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        break;
                    }
                }

            }
            catch { }
            finally
            {
                if (client != null)
                {
                    client.Audio.Writer.TryComplete();
                    client.Socket.Abort();
                    if (sending != null) await sending;
                    lock (_lock) _clients.Remove(client);
                }
                ws?.Dispose();
            }
        }

        public void BroadcastAudio(float[] samples, int count)
        {
            if (!_isRunning || count == 0) return;

            byte[] byteBuffer = new byte[count * 4];
            Buffer.BlockCopy(samples, 0, byteBuffer, 0, byteBuffer.Length);
            lock (_lock)
            {
                foreach (var client in _clients)
                {
                    if (!client.Audio.Writer.TryWrite(byteBuffer))
                    {
                        // A slow client must reconnect instead of losing pulse timing.
                        client.Audio.Writer.TryComplete();
                        client.Socket.Abort();
                    }
                }
            }
        }

        private static async Task SendAudio(Client client)
        {
            try
            {
                await foreach (var packet in client.Audio.Reader.ReadAllAsync())
                {
                    await client.Socket.SendAsync(new ArraySegment<byte>(packet), WebSocketMessageType.Binary, true, CancellationToken.None);
                }
            }
            catch { client.Socket.Abort(); }
        }

        public void Stop()
        {
            _isRunning = false;
            lock (_lock)
            {
                foreach (var client in _clients)
                {
                    client.Audio.Writer.TryComplete();
                    client.Socket.Abort();
                }
                _clients.Clear();
            }

            if (_httpListener != null)
            {
                try { _httpListener.Stop(); } catch { }
                _httpListener = null;
            }
        }

        public void Dispose() => Stop();
    }
}
