using System;
using System.Collections.Generic;
using System.Net;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;

namespace DeltaForceMoss.Services
{
    /// <summary>
    /// 免弹窗系统声音 WebSocket 本地广播服务 (ws://127.0.0.1:9999/audio)
    /// </summary>
    public class WebSocketAudioServer : IDisposable
    {
        private HttpListener? _httpListener;
        private readonly List<WebSocket> _clients = new();
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
            try
            {
                var wsContext = await context.AcceptWebSocketAsync(null);
                var ws = wsContext.WebSocket;

                lock (_lock)
                {
                    _clients.Add(ws);
                }
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

                lock (_lock)
                {
                    _clients.Remove(ws);
                }
                ws.Dispose();
            }
            catch { }
        }

        public void BroadcastAudio(float[] samples, int count)
        {
            if (!_isRunning || count == 0) return;

            byte[] byteBuffer = new byte[count * 4];
            Buffer.BlockCopy(samples, 0, byteBuffer, 0, byteBuffer.Length);
            var segment = new ArraySegment<byte>(byteBuffer);

            List<WebSocket> currentClients;
            lock (_lock)
            {
                currentClients = new List<WebSocket>(_clients);
            }

            foreach (var client in currentClients)
            {
                if (client.State == WebSocketState.Open)
                {
                    try
                    {
                        client.SendAsync(segment, WebSocketMessageType.Binary, true, CancellationToken.None);
                    }
                    catch { }
                }
            }
        }

        public void Stop()
        {
            _isRunning = false;
            lock (_lock)
            {
                foreach (var client in _clients)
                {
                    try { client.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closed", CancellationToken.None); } catch { }
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
