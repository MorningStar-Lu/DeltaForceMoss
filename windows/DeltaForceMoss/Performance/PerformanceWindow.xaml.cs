using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Win32;

namespace DeltaForceMoss.Performance;
public partial class PerformanceWindow : Window
{
    private MusicScore? score;private readonly PerformancePlayer player=new();private CancellationTokenSource? cancellation;
    private Task? playing;private IntPtr target;private uint targetProcess;private HwndSource? source;private bool hotkey;
    [DllImport("user32.dll")]private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern int GetWindowText(IntPtr window,StringBuilder text,int max);
    [DllImport("user32.dll")]private static extern bool RegisterHotKey(IntPtr window,int id,uint modifiers,uint key);
    [DllImport("user32.dll")]private static extern bool UnregisterHotKey(IntPtr window,int id);
    public PerformanceWindow(){InitializeComponent();SourceInitialized+=(_,_)=>{source=HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);source.AddHook(Hook);hotkey=RegisterHotKey(source.Handle,81,0x4000,0x77);if(!hotkey)State.Text="F8 热键被占用，无法启动；请关闭占用热键的程序后重新打开演奏窗口";};Closing+=(_,e)=>{if(playing is {IsCompleted:false}){e.Cancel=true;cancellation?.Cancel();_ = CloseAfterStop();}else Cleanup();};}
    private async Task CloseAfterStop(){if(playing!=null)await playing;Close();}
    private void Cleanup(){cancellation?.Dispose();if(source!=null){if(hotkey)UnregisterHotKey(source.Handle,81);source.RemoveHook(Hook);}}
    private IntPtr Hook(IntPtr hwnd,int msg,IntPtr w,IntPtr l,ref bool handled){if(msg==0x312&&w.ToInt32()==81){Stop_Click(this,new RoutedEventArgs());handled=true;}return IntPtr.Zero;}
    private void Import_Click(object sender,RoutedEventArgs e){if(playing is {IsCompleted:false})return;var dialog=new OpenFileDialog{Filter="鼠鼠曲谱 JSON|*.json"};if(dialog.ShowDialog()!=true)return;try{var parsed=MusicScore.Parse(File.ReadAllText(dialog.FileName,Encoding.UTF8));score=parsed;player.Reset();Progress.Value=0;Song.Text=$"{parsed.Name} · {parsed.Bpm} BPM · {parsed.Meter} · {parsed.Notes.Count} 音 · {parsed.TotalBeats:0.######} 拍";State.Text="已载入；选择目标窗口后开始";}catch(Exception ex){State.Text="导入失败："+ex.Message;}}
    private bool TargetActive(){var window=GetForegroundWindow();GetWindowThreadProcessId(window,out var process);return window==target&&process==targetProcess&&target!=IntPtr.Zero;}
    private async Task Countdown(string text,CancellationToken token){for(int i=3;i>0;i--){State.Text=$"{text} · {i} 秒";await Task.Delay(1000,token);}}
    private async void Target_Click(object sender,RoutedEventArgs e){if(playing is {IsCompleted:false})return;SelectTarget.IsEnabled=false;Play.IsEnabled=false;try{await Countdown("请切换到目标游戏窗口",CancellationToken.None);var window=GetForegroundWindow();GetWindowThreadProcessId(window,out var process);if(window==IntPtr.Zero||process==Environment.ProcessId)throw new InvalidOperationException("未选到外部窗口");target=window;targetProcess=process;var title=new StringBuilder(256);GetWindowText(window,title,256);TargetLabel.Text=$"目标：{title} · PID {process}";State.Text="目标已选择；开始前会再倒数 3 秒";}catch(Exception ex){State.Text=ex.Message;}finally{SelectTarget.IsEnabled=true;Play.IsEnabled=true;}}
    private static uint DeviceId(string s)=>s.StartsWith("0x",StringComparison.OrdinalIgnoreCase)?uint.Parse(s[2..],NumberStyles.HexNumber):uint.Parse(s,CultureInfo.InvariantCulture);
    private async void Play_Click(object sender,RoutedEventArgs e){
        if(playing is {IsCompleted:false})return;
        if(score==null||target==IntPtr.Zero||!hotkey){State.Text="请载入曲谱、选择目标窗口，并确保 F8 热键可用";return;}
        var useSk=Backend.SelectedIndex==1;uint vid=0,pid=0;var verify=Verify.Password;var mouseVerify=MouseVerify.Password;
        try{if(useSk){vid=DeviceId(Vid.Text);pid=DeviceId(Pid.Text);}}catch(Exception ex){State.Text="设备编号无效："+ex.Message;return;}
        if(player.PositionSeconds>=score.TotalBeats*60/score.Bpm)player.Reset();
        cancellation?.Dispose();cancellation=new();var token=cancellation.Token;
        SetBusy(true);playing=Perform();await playing;SetBusy(false);
        async Task Perform(){try{await Countdown("请切换到已选目标窗口",token);token.ThrowIfCancellationRequested();if(!TargetActive())throw new InvalidOperationException("当前不是已选目标窗口，未发送输入");
            await Task.Run(()=>{using IInputBackend backend=useSk?new SKSimulatorBackend(vid,pid,verify,mouseVerify):new SendInputBackend();player.Run(score,backend,TargetActive,token,(index,seconds)=>Dispatcher.BeginInvoke(new Action(()=>{Progress.Value=seconds/(score.TotalBeats*60/score.Bpm)*100;State.Text=$"演奏中 · 第 {index+1}/{score.Notes.Count} 音 · {seconds:0.00} 秒";})));},token);
            State.Text="演奏结束，按键已释放";
        }catch(OperationCanceledException){State.Text="已暂停，按键已释放；可继续或停止回到开头";}catch(Exception ex){State.Text="演奏停止："+ex.Message;}finally{Verify.Clear();MouseVerify.Clear();}}
    }
    private void SetBusy(bool busy){Import.IsEnabled=Backend.IsEnabled=SelectTarget.IsEnabled=Play.IsEnabled=Vid.IsEnabled=Pid.IsEnabled=Verify.IsEnabled=MouseVerify.IsEnabled=!busy;Pause.IsEnabled=busy;}
    private void Pause_Click(object sender,RoutedEventArgs e)=>cancellation?.Cancel();
    private async void Stop_Click(object sender,RoutedEventArgs e){cancellation?.Cancel();if(playing!=null)await playing;player.Reset();Progress.Value=0;State.Text="已停止并回到开头";}
}
