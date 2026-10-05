# DeltaForceMoss · 摩斯密码门破译桌面客户端 (Windows EXE)

本项目是《三角洲行动》密码门摩斯破译器的 Windows 独立客户端程序。它突破了浏览器的限制，具备两大核心能力：

1. **WASAPI 系统音频全局静默捕获**：自动读取 Windows 默认播放设备的音频流（游戏声音），**无需在浏览器界面中手动选择共享窗口或勾选共享音频**。
2. **突破无边框窗口化全屏置顶**：提供无边框透明极简浮窗（`Topmost`），极简模式下**仅保留三位解码数字（如 `0 8 3`）及候选点划/斜杠进度**，不会遮挡游戏操作界面。

## 打包构建指南 (Build Guide)

需要 Windows 操作系统与 [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)。

### 1. 自包含单文件 EXE（免装 .NET 运行时，约 150 MB）

在终端运行以下打包命令：

```cmd
cd windows\DeltaForceMoss
dotnet publish -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true
```

生成的单文件 `.exe` 可执行文件将位于：
`bin\Release\net8.0-windows\win-x64\publish\DeltaForceMoss.exe`

用户无需安装 .NET 运行时，双击生成的 `DeltaForceMoss.exe` 即可直接运行使用！

### 2. 框架依赖小体积 EXE（约 2 MB，需装 .NET 8 桌面运行时）

```cmd
cd windows\DeltaForceMoss
dotnet publish -c Release -r win-x64 --self-contained false /p:PublishSingleFile=true
```

体积小得多，但目标机器需先安装 [.NET 8 桌面运行时](https://dotnet.microsoft.com/download/dotnet/8.0)。

### 3. SKSimulator 外接键鼠模拟器（可选）

`SendInput` 方式开箱即用；若要用外接键鼠模拟器，需要 SKSimulator 官方 SDK 的
`skm.dll`（第三方硬件 SDK，不随本仓库分发）：

1. 到 <https://github.com/scottfly189/SKSimulator> 的 `src\x64\` 取 `skm.dll`；
2. 放到 `windows\DeltaForceMoss\x64\skm.dll`（该目录已被 `.gitignore` 忽略），或直接
   放到发布输出目录 `publish\x64\skm.dll`；
3. 重新发布，`x64\skm.dll` 会随包输出。

缺少该文件时程序照常启动，只有选择 SKSimulator 后端开始演奏时才会提示缺少运行库。

### 4. 自动构建

推送到 `main` / `codex` 分支会触发 GitHub Actions（`.github/workflows/build-exe.yml`），
同时产出上面两个版本并附到以日期+短 SHA 命名的 Release。

## 极简浮窗功能说明

- **📌 钉住/置顶**：默认开启系统全局置顶，即使切换至游戏窗口也能始终保留在屏幕最上方。
- **拖拽移动**：按住窗口任意区域拖拽即可自由调整浮窗位置。
- **数字展示**：当捕捉到 5 组提示音时，大字号高亮显示解码密码（如 `0 8 3`）。
- **候选斜杠与点划**：实时显示当前的点划序列与分组斜杠（如 `· — — — — / — — — — —`）。
- **手动输入/清空**：底栏提供 `·` `—` `⌁` 按钮，支持在复杂声响时进行手动微调或清空。

## 监听修复与验证限制

点划现在按采样时长识别：游戏短音约 50 毫秒、长音约 140 毫秒；95–110 毫秒的模糊音保留 `?`，不猜成点。分析窗固定为 10 毫秒，不依赖 WASAPI 回调次数。支持浮点/扩展浮点和 16/24/32 位 PCM 输入。

免弹窗网页桥接会先发送实际采样率，音频包由网页重组后分析；exe 和网页需一起更新。网页合成信号测试：`node --test web/morse-bridge.test.mjs`；原生测试与限制见上级 README。真实游戏噪声、不同输出设备和系统权限仍需 Windows 实听核对；本次没有生成或验证新 exe。

挥刀误触发补充修复：原生音频识别先缓存脉冲，完整五段需通过同频（偏差不超过 100 Hz）、组内起点间隔 180–520 毫秒及单段频率稳定性校验，才写入点划记录。孤立声效不会直接显示为点；手动点划仍可立即输入。新增孤立音、节奏不规则音、跳频音与宽带噪声的原生合成负例，已纳入 Windows CI（`DecoderRegression`），随构建执行。没有用户真实挥刀录音，尚不能声称已验证该声效被滤除。
