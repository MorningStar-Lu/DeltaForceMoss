# Delta Force Audio

本地音频识别项目。目前可运行的是浏览器原型：声音监听台识别稳定单音并导出简谱；独立的摩斯解码台提供手动校对和实验性自动提示音识别，已有一次用户现场识别成功的反馈；节奏教练预览页可导入 TXT 曲谱并显示当前/下一个音符、时间线与进度。Windows 桌面端和 Android 端仍是开发预留目录。

## 快速运行网页原型

```bash
cd web
python3 -m http.server 4173
```

打开 `http://localhost:4173` 进入声音监听台，`/morse.html` 进入摩斯解码台，`/coach.html` 进入节奏教练预览。捕获系统声音时，在浏览器的分享窗口中选择来源并启用共享音频。音频只在本机浏览器处理。

## 目录

```text
web/               当前可运行的浏览器原型
windows/           Windows 桌面端预留（WPF / .NET）
android/           Android 端预留
shared/            跨平台数据格式与事件约定预留
docs/              功能状态与技术架构
temp exe/          第三方安装包、完整提取结果及分析工具缓存
```

详细功能状态和后续架构见 [技术架构](docs/architecture.md)。智能体接手开发时先读 [AGENTS.md](AGENTS.md)。`temp exe/` 仅用于研究参考程序，不是本项目的源码或构建产物；其中的第三方程序不应直接并入新客户端。
