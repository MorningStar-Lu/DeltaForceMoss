using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace DeltaForceMoss.Services
{
    /// <summary>
    /// 摩斯密码门音频识别引擎 (C# 原生版，支持自动重置与新一轮捕获)
    /// </summary>
    public class MorseDecoderEngine
    {
        public event Action<string>? OnDigitsUpdated;
        public event Action<string>? OnCandidatesUpdated;
        public event Action<string>? OnStatusUpdated;

        private readonly List<string> _morseGroups = new();
        private string _currentSymbols = "";
        private string _digits = "";

        private Timer? _autoResetTimer;
        private int _autoResetCountdown = 0;

        // 摩斯数字对应表
        private static readonly Dictionary<string, string> MorseToDigitMap = new()
        {
            { "-----", "0" },
            { ".----", "1" },
            { "..---", "2" },
            { "...--", "3" },
            { "....-", "4" },
            { ".....", "5" },
            { "-....", "6" },
            { "--...", "7" },
            { "---..", "8" },
            { "----.", "9" }
        };

        private int _toneDurationFrames = 0;
        private int _silenceDurationFrames = 0;

        public void ProcessAudio(float[] samples, int count, int sampleRate)
        {
            if (count == 0 || sampleRate <= 0) return;

            // 计算简易 4200Hz 高频/全带强信号能量
            float targetHz = 4200f;
            float k = 0.5f + (count * targetHz / sampleRate);
            float omega = (float)(2.0 * Math.PI * k / count);
            float cosine = (float)Math.Cos(omega);
            float coeff = 2.0f * cosine;

            float q0 = 0, q1 = 0, q2 = 0;
            for (int i = 0; i < count; i++)
            {
                q0 = coeff * q1 - q2 + samples[i];
                q2 = q1;
                q1 = q0;
            }
            float magnitude = (float)Math.Sqrt(q1 * q1 + q2 * q2 - q1 * q2 * coeff);

            // 动态门限阈值
            float threshold = 1.5f;
            bool isTone = magnitude > threshold;

            if (isTone)
            {
                _toneDurationFrames++;
                if (_silenceDurationFrames > 0)
                {
                    _silenceDurationFrames = 0;
                }
            }
            else
            {
                _silenceDurationFrames++;
                if (_toneDurationFrames > 0)
                {
                    // 音符结束，分类短音(.)/长音(-)
                    if (_toneDurationFrames >= 2 && _toneDurationFrames <= 8)
                    {
                        AddSymbol(".");
                    }
                    else if (_toneDurationFrames > 8)
                    {
                        AddSymbol("-");
                    }
                    _toneDurationFrames = 0;
                }
            }
        }

        public void AddSymbol(string symbol)
        {
            // 如果上轮已完成 3 位，监听到新提示音时自动开辟新一轮
            if (_digits.Length >= 3)
            {
                CancelAutoReset();
                _digits = "";
                _morseGroups.Clear();
            }

            if (_currentSymbols.Length >= 5) _currentSymbols = "";
            _currentSymbols += symbol;

            UpdateUI();

            if (_currentSymbols.Length == 5)
            {
                if (MorseToDigitMap.TryGetValue(_currentSymbols, out var digit))
                {
                    CommitDigit(digit);
                }
                else
                {
                    CommitDigit("?");
                }
            }
        }

        private void CommitDigit(string digit)
        {
            _digits += digit;
            _morseGroups.Add(_currentSymbols);
            _currentSymbols = "";

            if (_digits.Length == 3)
            {
                StartAutoResetTimer();
            }

            UpdateUI();
        }

        private void StartAutoResetTimer()
        {
            CancelAutoReset();
            _autoResetCountdown = 10;
            OnStatusUpdated?.Invoke("● 已完成破译 · 10 秒后自动重置准备下一轮");

            _autoResetTimer = new Timer(state =>
            {
                _autoResetCountdown--;
                if (_autoResetCountdown > 0)
                {
                    OnStatusUpdated?.Invoke($"● 已完成破译 · {_autoResetCountdown}s 后自动重置");
                    OnCandidatesUpdated?.Invoke($"破译完成 · {_autoResetCountdown}s 后重置准备下一轮");
                }
                else
                {
                    CancelAutoReset();
                    Clear();
                    OnStatusUpdated?.Invoke("● 已自动重置 · 准备捕获下一个密码门");
                }
            }, null, 1000, 1000);
        }

        private void CancelAutoReset()
        {
            if (_autoResetTimer != null)
            {
                _autoResetTimer.Dispose();
                _autoResetTimer = null;
            }
            _autoResetCountdown = 0;
        }

        public void ManualAddSymbol(string symbol)
        {
            AddSymbol(symbol);
        }

        public void Clear()
        {
            CancelAutoReset();
            _digits = "";
            _currentSymbols = "";
            _morseGroups.Clear();
            UpdateUI();
        }

        private void UpdateUI()
        {
            string displayDigits = (_digits + "───").Substring(0, 3);
            OnDigitsUpdated?.Invoke(displayDigits);

            var traceList = new List<string>(_morseGroups);
            if (!string.IsNullOrEmpty(_currentSymbols)) traceList.Add(_currentSymbols);

            string trace = traceList.Count > 0 ? string.Join(" / ", traceList) : "/ / / (等待信号)";
            OnCandidatesUpdated?.Invoke(trace);
        }
    }
}
