using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace DeltaForceMoss.Performance;
public interface IInputBackend : IDisposable
{
    void Key(string key,bool down);
    void Mouse(int button,bool down); // 0 左键，1 中键，2 右键
    void ReleaseAll();
}
public sealed class SendInputBackend : IInputBackend
{
    private readonly HashSet<string> keys=new();private readonly HashSet<int> buttons=new();
    [StructLayout(LayoutKind.Sequential)]private struct Keyboard {public ushort Vk,Scan;public uint Flags,Time;public UIntPtr Extra;}
    [StructLayout(LayoutKind.Sequential)]private struct MouseData {public int X,Y;public uint Data,Flags,Time;public UIntPtr Extra;}
    [StructLayout(LayoutKind.Explicit)]private struct Union {[FieldOffset(0)]public Keyboard Keyboard;[FieldOffset(0)]public MouseData Mouse;}
    [StructLayout(LayoutKind.Sequential)]private struct Input {public uint Type;public Union Data;}
    [DllImport("user32.dll",SetLastError=true)]private static extern uint SendInput(uint count,Input[] inputs,int size);
    [DllImport("user32.dll")]private static extern uint MapVirtualKey(uint code,uint mode);
    private static void Send(Input input){if(SendInput(1,new[]{input},Marshal.SizeOf<Input>())!=1)throw new Win32Exception(Marshal.GetLastWin32Error(),"SendInput 未发送成功，请检查目标权限");}
    public void Key(string key,bool down){var vk=key==","?0xBC:key[0];if(down)keys.Add(key);Send(new(){Type=1,Data=new(){Keyboard=new(){Scan=(ushort)MapVirtualKey((uint)vk,0),Flags=8u|(down?0u:2u)}}});if(!down)keys.Remove(key);}
    public void Mouse(int button,bool down){if(down)buttons.Add(button);var flags=button switch{0=>down?2u:4u,1=>down?32u:64u,2=>down?8u:16u,_=>throw new ArgumentException("鼠标键无效")};Send(new(){Type=0,Data=new(){Mouse=new(){Flags=flags}}});if(!down)buttons.Remove(button);}
    public void ReleaseAll(){Exception? failure=null;foreach(var k in new List<string>(keys))try{Key(k,false);}catch(Exception e){failure=e;}foreach(var b in new List<int>(buttons))try{Mouse(b,false);}catch(Exception e){failure=e;}if(failure!=null)throw failure;}
    public void Dispose()=>ReleaseAll();
}
// 接口声明依据 SKSimulator 官方 C# SDK；独立实现，不加载第三方提取程序集。
public sealed class SKSimulatorBackend : IInputBackend
{
    private IntPtr device;
    static SKSimulatorBackend(){NativeLibrary.SetDllImportResolver(typeof(SKSimulatorBackend).Assembly,(name,assembly,path)=>name=="skm.dll"?NativeLibrary.Load(Path.Combine(AppContext.BaseDirectory,"x64","skm.dll")):IntPtr.Zero);}
    [DllImport("skm.dll")]private static extern uint HKMSearchDevice(uint vid,uint pid,uint deviceType);
    [DllImport("skm.dll")]private static extern IntPtr HKMOpen(uint id,uint dpiMode);
    [DllImport("skm.dll")]private static extern bool HKMIsOpen(IntPtr d,uint flags);
    [DllImport("skm.dll")]private static extern bool HKMClose(IntPtr d);
    [DllImport("skm.dll",CharSet=CharSet.Unicode)]private static extern bool HKMKeyDown(IntPtr d,string key);
    [DllImport("skm.dll",CharSet=CharSet.Unicode)]private static extern bool HKMKeyUp(IntPtr d,string key);
    [DllImport("skm.dll")]private static extern bool HKMLeftDown(IntPtr d);
    [DllImport("skm.dll")]private static extern bool HKMLeftUp(IntPtr d);
    [DllImport("skm.dll")]private static extern bool HKMMiddleDown(IntPtr d);
    [DllImport("skm.dll")]private static extern bool HKMMiddleUp(IntPtr d);
    [DllImport("skm.dll")]private static extern bool HKMRightDown(IntPtr d);
    [DllImport("skm.dll")]private static extern bool HKMRightUp(IntPtr d);
    [DllImport("skm.dll")]private static extern bool HKMReleaseKeyboard(IntPtr d);
    [DllImport("skm.dll")]private static extern bool HKMReleaseMouse(IntPtr d);
    [DllImport("skm.dll",CharSet=CharSet.Unicode)]private static extern uint HKMVerifyUserData2(IntPtr d,string data,bool mouse);
    [DllImport("skm.dll")]private static extern uint HKMGetSerialNumber(IntPtr d,bool mouse);
    public SKSimulatorBackend(uint vid,uint pid,string verify,string mouseVerify="")
    {
        if(string.IsNullOrWhiteSpace(verify))throw new InvalidOperationException("请输入设备校验数据");
        var dll=Path.Combine(AppContext.BaseDirectory,"x64","skm.dll");
        if(!File.Exists(dll))throw new InvalidOperationException($"未找到键鼠模拟器运行库：{dll}。请把 SKSimulator SDK 的 x64/skm.dll 放到该目录后重试");
        // 官方 KMSimulatorService.Init 会在设备上电后等待 600 毫秒再搜索，否则首次搜索可能落空。
        Thread.Sleep(600);
        var id=HKMSearchDevice(vid,pid,0);if(id==uint.MaxValue)throw new InvalidOperationException("未找到键鼠模拟器，请确认设备已连接");
        device=HKMOpen(id,0);if(device==IntPtr.Zero)throw new InvalidOperationException("打开设备失败");
        try{foreach(var mouse in new[]{false,true}){var serial=HKMGetSerialNumber(device,mouse);if(serial==0||HKMVerifyUserData2(device,mouse&&!string.IsNullOrWhiteSpace(mouseVerify)?mouseVerify:verify,mouse)!=serial)throw new InvalidOperationException("设备键盘或鼠标校验失败");}ReleaseAll();}
        catch{HKMClose(device);device=IntPtr.Zero;throw;}
    }
    // HKMIsOpen 的 Flags 官方用法为 0；仅当按键调用本身返回 false 时才视为断开。
    private void Check(bool ok){if(!ok||!HKMIsOpen(device,0))throw new InvalidOperationException("设备断开或输入失败，演奏已停止");}
    public void Key(string key,bool down)=>Check(down?HKMKeyDown(device,key):HKMKeyUp(device,key));
    public void Mouse(int b,bool down)=>Check(b switch{0=>down?HKMLeftDown(device):HKMLeftUp(device),1=>down?HKMMiddleDown(device):HKMMiddleUp(device),2=>down?HKMRightDown(device):HKMRightUp(device),_=>false});
    public void ReleaseAll(){if(device==IntPtr.Zero)return;var keyboard=HKMReleaseKeyboard(device);var mouse=HKMReleaseMouse(device);if(!keyboard||!mouse)throw new InvalidOperationException("设备释放失败，请检查连接");}
    public void Dispose(){try{ReleaseAll();}finally{if(device!=IntPtr.Zero){HKMClose(device);device=IntPtr.Zero;}}}
}
