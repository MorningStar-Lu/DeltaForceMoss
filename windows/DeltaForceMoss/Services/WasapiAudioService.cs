using System;
using NAudio.Wave;

namespace DeltaForceMoss.Services
{
    /// <summary>
    /// WASAPI 全局系统声音监听服务（支持免弹窗监听系统扬声器输出）
    /// </summary>
    public class WasapiAudioService : IDisposable
    {
        private WasapiLoopbackCapture? _capture;
        public event Action<float[], int>? OnAudioData;
        public event Action<string>? OnStatusChanged;
        public bool IsCapturing { get; private set; }
        public int SampleRate => _capture?.WaveFormat.SampleRate ?? 44100;

        public void Start()
        {
            if (IsCapturing) return;

            try
            {
                _capture = new WasapiLoopbackCapture();
                _capture.DataAvailable += (s, e) =>
                {
                    if (e.BytesRecorded == 0) return;

                    var waveFormat = _capture.WaveFormat;
                    int samplesRecorded = e.BytesRecorded / (waveFormat.BitsPerSample / 8);
                    float[] floatBuffer = new float[samplesRecorded];

                    if (waveFormat.Encoding == WaveFormatEncoding.IeeeFloat)
                    {
                        for (int i = 0; i < samplesRecorded; i++)
                        {
                            floatBuffer[i] = BitConverter.ToSingle(e.Buffer, i * 4);
                        }
                    }
                    else if (waveFormat.BitsPerSample == 16)
                    {
                        for (int i = 0; i < samplesRecorded; i++)
                        {
                            short sample = BitConverter.ToInt16(e.Buffer, i * 2);
                            floatBuffer[i] = sample / 32768f;
                        }
                    }

                    // 如果是双声道/多声道，转换为单声道
                    int channels = waveFormat.Channels;
                    if (channels > 1)
                    {
                        int monoCount = samplesRecorded / channels;
                        float[] monoBuffer = new float[monoCount];
                        for (int i = 0; i < monoCount; i++)
                        {
                            float sum = 0;
                            for (int c = 0; c < channels; c++)
                            {
                                sum += floatBuffer[i * channels + c];
                            }
                            monoBuffer[i] = sum / channels;
                        }
                        OnAudioData?.Invoke(monoBuffer, monoCount);
                    }
                    else
                    {
                        OnAudioData?.Invoke(floatBuffer, samplesRecorded);
                    }
                };

                _capture.RecordingStopped += (s, e) =>
                {
                    IsCapturing = false;
                    OnStatusChanged?.Invoke("WASAPI 监听已停止");
                };

                _capture.StartRecording();
                IsCapturing = true;
                OnStatusChanged?.Invoke("● 全局系统音频监听中 (WASAPI)");
            }
            catch (Exception ex)
            {
                IsCapturing = false;
                OnStatusChanged?.Invoke($"捕获异常: {ex.Message}");
            }
        }

        public void Stop()
        {
            if (_capture != null)
            {
                try { _capture.StopRecording(); } catch { }
                _capture.Dispose();
                _capture = null;
            }
            IsCapturing = false;
            OnStatusChanged?.Invoke("待机");
        }

        public void Dispose()
        {
            Stop();
        }
    }
}
