using System;
using System.Windows;
using System.Windows.Input;
using DeltaForceMoss.Services;

namespace DeltaForceMoss
{
    public partial class MainWindow : Window
    {
        private readonly WasapiAudioService _wasapiService;
        private readonly MorseDecoderEngine _decoderEngine;
        private readonly WebSocketAudioServer _wsServer;
        private bool _isPinned = true;

        public MainWindow()
        {
            InitializeComponent();

            _wasapiService = new WasapiAudioService();
            _decoderEngine = new MorseDecoderEngine();
            _wsServer = new WebSocketAudioServer();

            // 订阅引擎事件
            _decoderEngine.OnDigitsUpdated += digits =>
            {
                Dispatcher.InvokeAsync(() => DigitsText.Text = digits);
            };

            _decoderEngine.OnCandidatesUpdated += candidates =>
            {
                Dispatcher.InvokeAsync(() => CandidateText.Text = candidates);
            };

            _wasapiService.OnStatusChanged += status =>
            {
                Dispatcher.InvokeAsync(() => StatusText.Text = status);
            };

            _decoderEngine.OnStatusUpdated += status => Dispatcher.InvokeAsync(() => StatusText.Text = status);

            // 订阅 WASAPI 音频帧，同时广播给 WebSocket 前端网页
            _wasapiService.OnAudioData += (samples, count) =>
            {
                _decoderEngine.ProcessAudio(samples, count, _wasapiService.SampleRate);
                _wsServer.BroadcastAudio(samples, count);
            };

            Loaded += (s, e) =>
            {
                try
                {
                    _wasapiService.Start();
                    _wsServer.SampleRate = _wasapiService.SampleRate;
                    _wsServer.Start(9999);
                }
                catch (Exception ex)
                {
                    StatusText.Text = $"启动失败: {ex.Message}";
                }
            };

            Closing += (s, e) =>
            {
                _wsServer.Dispose();
                _wasapiService.Dispose();
                _decoderEngine.Dispose();
            };
        }

        private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed)
            {
                DragMove();
            }
        }

        private Performance.PerformanceWindow? _performanceWindow;
        private void Performance_Click(object sender, RoutedEventArgs e)
        {
            if (_performanceWindow == null) { _performanceWindow = new Performance.PerformanceWindow { Owner = this }; _performanceWindow.Closed += (_, _) => _performanceWindow = null; _performanceWindow.Show(); }
            else _performanceWindow.Activate();
        }

        private void PinBtn_Click(object sender, RoutedEventArgs e)
        {
            _isPinned = !_isPinned;
            Topmost = _isPinned;
            PinBtn.Foreground = _isPinned ? System.Windows.Media.Brushes.Cyan : System.Windows.Media.Brushes.Gray;
        }

        private void MinBtn_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState.Minimized;
        }

        private void CloseBtn_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }

        private void DotBtn_Click(object sender, RoutedEventArgs e)
        {
            _decoderEngine.ManualAddSymbol(".");
        }

        private void DashBtn_Click(object sender, RoutedEventArgs e)
        {
            _decoderEngine.ManualAddSymbol("-");
        }

        private void ClearBtn_Click(object sender, RoutedEventArgs e)
        {
            _decoderEngine.Clear();
        }
    }
}
