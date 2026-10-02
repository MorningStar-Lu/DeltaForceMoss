# 安装包静态分析缓存

原始安装包：`original/鼠鼠口琴谱-安装包-v2.0.18.exe`（未修改）

- SHA-256：`b5ba449d7eae2b93cd0fe698a5250655feb6c3d3b4af384527c10d1d8a758c7c`
- 大小：53,352,637 字节
- 类型：Inno Setup 6.7.0 Windows 安装包
- 可见产品名：鼠鼠口琴谱

## 提取结果

已使用 `tools/innoextract2-src/build/innoextract` 将安装包列出的 **251 个文件全部提取**到 `extracted/app/`。该工具来自支持 Inno Setup 6.7 的 `3xHk/innoextract2` 分支。原安装包未修改。

- 主程序集：`extracted/app/HarmonicaMacro.dll`（.NET 8，WPF，约 4.9 MiB）
- 主程序入口：`extracted/app/HarmonicaMacro.exe`
- 中文启动程序：`extracted/app/鼠鼠口琴谱启动.exe`
- 其余为 .NET/WPF 运行库及 WebView2 组件。
- 安装包内的 `release-integrity.json` 列出上述三个应用文件的 SHA-256；提取后逐一计算，**三项全部匹配**。

解包器曾对 251 个文件打印“无法回读以计算多段文件输出校验和”的警告；文件实际存在，三个主要应用文件的发行校验值均匹配。后续如需验证所有运行库，可在 Windows 上安装后与此目录逐项比较。

主程序集可见“曲谱悬浮窗”“教练模式开关”“口琴教练配置”“跟随谱面节奏演奏”等字符串；具体窗口类、流程及哪些功能受权限限制仍需进一步反编译确认。

## 工具记录

- `tools/innounp-2.zip` 和 `tools/innounp/`：Windows 版解包器，仅作备用。
- macOS 自带的 `innoextract 1.9`、`7z 17.05`、`7zz 26.03` 和试用的 Go 解包器无法读取此版本安装包。
