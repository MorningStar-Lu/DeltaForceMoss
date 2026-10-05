using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace DeltaForceMoss.Services
{
    /// <summary>
    /// 摩斯密码门音频识别引擎 (C# 原生版，支持自动重置与新一轮捕获)
    /// </summary>
    public class MorseDecoderEngine : IDisposable
    {
        public event Action<string>? OnDigitsUpdated;
        public event Action<string>? OnCandidatesUpdated;
        public event Action<string>? OnStatusUpdated;

        private readonly object _stateLock = new();
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

        // Analyse fixed 10 ms windows. WASAPI callback sizes are not a clock.
        private float[] _frame = Array.Empty<float>();
        private int _filled, _sampleRate, _onFrames, _offFrames;
        private readonly List<(string Symbol, double Start, double Hz)> _audioPulses = new();
        private double _detectedHz, _pulseHz;
        private bool _unstablePulse;
        private double _clockMs, _firstOn, _firstOff, _toneStart = -1, _lastEnd = -1;

        public void ProcessAudio(float[] samples, int count, int sampleRate)
        {
            lock (_stateLock)
            {
                if (count <= 0 || count > samples.Length || sampleRate < 10000) return;
                if (_sampleRate != sampleRate)
                {
                    ResetAudio();
                    _sampleRate = sampleRate;
                    _frame = new float[Math.Max(1, sampleRate / 100)];
                }
                for (int i = 0; i < count; i++)
                {
                    _frame[_filled++] = samples[i];
                    if (_filled != _frame.Length) continue;
                    _filled = 0;
                    _clockMs += 1000.0 * _frame.Length / sampleRate;
                    ObserveTone(HasCue(), _clockMs);
                }
            }
        }

        private double Amplitude(double hz)
        {
            double coefficient = 2 * Math.Cos(2 * Math.PI * hz / _sampleRate);
            double q1 = 0, q2 = 0;
            for (int i = 0; i < _frame.Length; i++)
            {
                double window = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (_frame.Length - 1));
                double q0 = coefficient * q1 - q2 + _frame[i] * window;
                q2 = q1; q1 = q0;
            }
            return Math.Sqrt(Math.Max(0, q1 * q1 + q2 * q2 - coefficient * q1 * q2)) * 4 / _frame.Length;
        }

        private bool HasCue()
        {
            double peak = 0;
            for (int hz = 4100; hz <= 4400; hz += 50)
            {
                double amplitude = Amplitude(hz);
                if (amplitude > peak) { peak = amplitude; _detectedHz = hz; }
            }
            double noise = (Amplitude(3500) + Amplitude(3700) + Amplitude(4800) + Amplitude(5000)) / 4;
            return peak > 0.0032 && peak > noise * 15;
        }

        private void ObserveTone(bool present, double time)
        {
            if (present)
            {
                if (_onFrames++ == 0 && _toneStart < 0)
                {
                    _firstOn = time;
                    _pulseHz = _detectedHz;
                    _unstablePulse = false;
                }
                if (Math.Abs(_detectedHz - _pulseHz) > 100) _unstablePulse = true;
                _offFrames = 0;
                if (_toneStart < 0 && _onFrames >= 2) _toneStart = _firstOn;
                return;
            }
            _onFrames = 0;
            if (_toneStart < 0) return;
            if (_offFrames++ == 0) _firstOff = time;
            if (_offFrames < 2) return;
            double duration = _firstOff - _toneStart;
            double start = _toneStart;
            double gap = _lastEnd < 0 ? double.PositiveInfinity : start - _lastEnd;
            _toneStart = -1;
            _offFrames = 0;
            if (duration < 30 || duration > 230 || _unstablePulse)
            {
                _audioPulses.Clear();
                return;
            }
            _lastEnd = _firstOff;
            if (gap > 440) _audioPulses.Clear();
            if (gap > 1200 && _digits.Length < 3)
            {
                _digits = "";
                _currentSymbols = "";
                _morseGroups.Clear();
            }
            // Real game cues: dots ~50 ms, dashes ~140 ms. Ambiguous pulses
            // retain their position instead of silently becoming dots.
            string symbol = duration < 95 ? "." : duration >= 110 ? "-" : "?";
            if (_audioPulses.Count > 0)
            {
                double cadence = start - _audioPulses[^1].Start;
                bool sameFrequency = _audioPulses.All(pulse => Math.Abs(pulse.Hz - _pulseHz) <= 100);
                if (cadence < 180 || cadence > 520 || !sameFrequency) _audioPulses.Clear();
            }
            _audioPulses.Add((symbol, start, _pulseHz));
            // A single effect is not evidence of Morse. Publish only after a
            // complete five-pulse group has stable frequency and game cadence.
            if (_audioPulses.Count < 5) return;
            string group = string.Concat(_audioPulses.Select(pulse => pulse.Symbol));
            _audioPulses.Clear();
            _currentSymbols = "";
            foreach (char value in group) AddSymbol(value.ToString());
            if (!MorseToDigitMap.ContainsKey(group))
                OnStatusUpdated?.Invoke("● 提示音组不确定 · 请核对");
        }

        private void ResetAudio()
        {
            _audioPulses.Clear();
            _unstablePulse = false;
            _pulseHz = _detectedHz = 0;
            _filled = _onFrames = _offFrames = 0;
            _clockMs = 0;
            _toneStart = _lastEnd = -1;
        }

        public void AddSymbol(string symbol)
        {
            lock (_stateLock)
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
                lock (_stateLock)
                {
                    if (_autoResetCountdown <= 0) return;
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
            lock (_stateLock)
            {
                CancelAutoReset();
                ResetAudio();
                _digits = "";
                _currentSymbols = "";
                _morseGroups.Clear();
                UpdateUI();
            }
        }

        public void Dispose()
        {
            lock (_stateLock) CancelAutoReset();
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
