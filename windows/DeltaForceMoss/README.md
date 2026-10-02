# DeltaForceMoss · 摩斯密码门破译桌面客户端 (Windows EXE)

本项目是《三角洲行动》密码门摩斯破译器的 Windows 独立客户端程序。它突破了浏览器的限制，具备两大核心能力：

1. **WASAPI 系统音频全局静默捕获**：自动读取 Windows 默认播放设备的音频流（游戏声音），**无需在浏览器界面中手动选择共享窗口或勾选共享音频**。
2. **突破无边框窗口化全屏置顶**：提供无边框透明极简浮窗（`Topmost`），极简模式下**仅保留三位解码数字（如 `0 8 3`）及候选点划/斜杠进度**，不会遮挡游戏操作界面。

## 打包构建指南 (Build Guide)

需要 Windows 操作系统与 [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)。

### 1. 发布为独立单文件 EXE (Self-Contained Executable)

在终端运行以下打包命令：

```cmd
cd windows\DeltaForceMoss
dotnet publish -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true
```

生成的单文件 `.exe` 可执行文件将位于：
`bin\Release\net8.0-windows\win-x64\publish\DeltaForceMoss.exe`

用户无需安装 .NET 运行时，双击生成的 `DeltaForceMoss.exe` 即可直接运行使用！

## 极简浮窗功能说明

- **📌 钉住/置顶**：默认开启系统全局置顶，即使切换至游戏窗口也能始终保留在屏幕最上方。
- **拖拽移动**：按住窗口任意区域拖拽即可自由调整浮窗位置。
- **数字展示**：当捕捉到 5 组提示音时，大字号高亮显示解码密码（如 `0 8 3`）。
- **候选斜杠与点划**：实时显示当前的点划序列与分组斜杠（如 `· — — — — / — — — — —`）。
- **手动输入/清空**：底栏提供 `·` `—` `⌁` 按钮，支持在复杂声响时进行手动微调或清空。
