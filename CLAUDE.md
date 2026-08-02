# CLAUDE.md — Qxq 项目指南

## 项目概述

Qxq 是一款基于 Tauri v2 的跨平台截图工具（Windows / macOS），追求简单高效的使用体验。

- **版本**: 0.8.0
- **标识符**: com.chao.qxq
- **仓库**: https://github.com/mg-chao/qxq
- **许可证**: GPL-3.0（双许可：Commercial / NonCommercial）

## 技术栈

| 层级 | 技术 |
|------|------|
| GUI 框架 | Tauri v2.8+ |
| 前端 | React 19 + TypeScript 5.9 |
| 路由 | TanStack Router v1.134+（代码分割，自动生成路由树） |
| 构建 | Rsbuild 1.5.17 + Rspack + SWC |
| UI 库 | Ant Design 5.28 + @ant-design/pro-components |
| 标注绘图 | @mg-chao/excalidraw（本地定制版）+ PixiJS 8.14 |
| 格式化 | Biome 2.2.6（替代 ESLint + Prettier） |
| 包管理 | pnpm 10.8.1（前端）、yarn 1.22.22（仅 Excalidraw） |
| Rust | Edition 2024, rust-version 1.90, Cargo workspace（14 个内部 crate） |
| i18n | react-intl（中文简体/繁体/英文） |
| OCR | ONNX Runtime（静态编译） |
| 视频录制 | FFmpeg CLI（可选插件） |

## 常用命令

```bash
# 开发
pnpm tauri dev              # 同时启动前端 + Rust 后端开发
pnpm dev                    # 仅启动前端开发服务器（端口 8083）

# 构建
pnpm build                  # 前端构建到 dist/
pnpm tauri build            # 完整构建（前端 + Rust → 安装包）

# 代码质量
pnpm lint                   # Biome 格式化 + 检查
pnpm lint:fix               # Biome 自动修复

# 调试
pnpm dev:rsdoctor           # Rsdoctor 构建分析
pnpm build:analyze          # 打包体积分析

# Excalidraw 依赖更新
pnpm update:excalidraw      # 重新构建并链接本地 excalidraw 包
```

## 项目结构

```
qxq/
├── src/                          # 前端源码
│   ├── App.tsx                   # 根组件
│   ├── index.tsx                 # 入口（React 19 createRoot）
│   ├── routeTree.gen.ts          # 自动生成的路由树（只读，勿手动编辑）
│   ├── commands/                 # Tauri invoke 命令封装
│   ├── components/               # 共享 UI 组件
│   ├── constants/                # 常量定义
│   ├── contexts/                 # React Context（appContext, pluginService, antd 等）
│   ├── functions/                # 业务函数（截图、翻译等）
│   ├── hooks/                    # 自定义 Hooks
│   ├── messages/                 # i18n 翻译文件（zhHans/zhHant/en）
│   ├── pages/                    # 页面组件
│   │   ├── draw/                 # 截图标注页面（核心）
│   │   ├── home/                 # 首页
│   │   ├── fixedContent/         # 固定到屏幕
│   │   ├── floatingToolbar/      # 浮动快捷工具栏
│   │   ├── fullScreenDraw/       # 全屏标注
│   │   ├── settings/             # 设置页面
│   │   └── videoRecord/          # 视频录制
│   ├── routes/                   # TanStack Router 路由定义
│   │   ├── __root.tsx            # 根路由
│   │   ├── _layout/              # 有菜单布局的路由
│   │   └── _noLayout/            # 无菜单布局（draw, fixedContent 等独立窗口）
│   ├── services/                 # 服务层（API 调用）
│   ├── types/                    # TypeScript 类型
│   └── utils/                    # 工具函数
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 程序入口（支持 --auto_start 延迟启动）
│   │   ├── lib.rs                # Tauri 插件注册 + 命令注册（核心）
│   │   ├── core.rs               # 核心功能（窗口、剪贴板、系统）
│   │   ├── screenshot.rs         # 截图功能
│   │   ├── scroll_screenshot.rs  # 滚动截图
│   │   ├── ocr.rs                # OCR
│   │   └── ...
│   ├── src-crates/               # Workspace 内部 crate
│   │   ├── app-utils/            # 工具库（图像编码、HDR 处理）
│   │   ├── app-services/         # 核心服务（OCR、文件缓存、设备事件）
│   │   ├── app-os/               # OS 交互（UI Automation）
│   │   ├── app-scroll-screenshot-service/  # 滚动截图服务
│   │   ├── app-shared/           # 共享类型
│   │   ├── global_state/         # 全局状态
│   │   ├── http-services/        # HTTP 服务
│   │   └── tauri-commands/       # Tauri 命令实现
│   │       ├── core/             # 核心命令
│   │       ├── screenshot/       # 截图命令
│   │       ├── ocr/              # OCR 命令
│   │       ├── file/             # 文件命令
│   │       └── scroll-screenshot/# 滚动截图命令
│   ├── tauri.conf.json           # Tauri 配置
│   ├── Cargo.toml                # Rust workspace 配置
│   └── capabilities/             # Tauri v2 权限配置
├── public/                       # 静态资源（scripts, images, audios）
├── biome.json                    # Biome 格式化配置
├── rsbuild.config.ts             # Rsbuild 构建配置
├── tsconfig.json                 # TypeScript 配置
└── package.json                  # 前端依赖
```

## 关键架构

### 截图调用链路

```
用户点击按钮 / 全局快捷键
  → executeScreenshot()           # src/functions/screenshot.ts
  → emit("execute-screenshot")    # Tauri 全局事件广播
  → draw 窗口监听事件              # src/pages/draw/page.tsx
  → captureAllMonitorsAction()    # Rust 后端截图
  → readyCapture()                # 显示标注界面
```

**重要**: draw 窗口是独立的 Tauri 窗口（`_noLayout` 路由），通过事件驱动与主窗口通信。draw 窗口必须处于 `Active` 状态才能处理截图请求。

### 插件系统

三个核心插件（通过 `pluginServiceContextProvider` 管理状态）：
- `rapid_ocr` — OCR 文字识别
- `ffmpeg` — 视频录制
- `translate` — 翻译

功能按钮和快捷键根据插件就绪状态（`isReadyStatus`）动态显示/隐藏。

### 多窗口架构

| 窗口 | 路由 | 布局 | 说明 |
|------|------|------|------|
| main | `/` | MenuLayout（侧边栏+菜单） | 主窗口，应用入口 |
| draw | `/draw` | 无布局 | 截图标注窗口 |
| fixedContent | `/fixedContent` | 无布局 | 固定到屏幕 |
| floatingToolbar | `/floatingToolbar` | 无布局 | 浮动快捷工具栏 |
| fullScreenDraw | `/fullScreenDraw` | 无布局 | 全屏标注 |
| videoRecord | `/videoRecord` | 无布局 | 视频录制工具栏 |

### 状态管理

- **React Context**: appContext（主题/窗口）、pluginService（插件状态）、appSettings（设置）
- **Publisher 模式**: `useStatePublisher` / `useStateSubscriber` 用于跨组件状态共享
- **IndexedDB**: Excalidraw 画板状态持久化
- **Tauri Store**: 应用设置持久化

## 代码规范

- **缩进**: Tab
- **引号**: 双引号
- **尾逗号**: 所有
- **格式化工具**: Biome（不是 ESLint/Prettier）
- **行尾符**: LF（.gitattributes 强制）
- **路由树**: `routeTree.gen.ts` 由 TanStack Router 自动生成，勿手动编辑
- **提交规范**: Conventional Commits（feat/fix/docs/refactor/perf 等）

## 外部依赖准备

1. **Excalidraw**: clone 到项目同级目录，切换到 `custom/master` 分支，`yarn install`，然后 `pnpm update:excalidraw`
2. **ONNX Runtime**: 下载静态库放到 `src-tauri/lib/`
3. **FFmpeg**（可选）: 放入 `src-tauri/ffmpeg/`

## 注意事项

- **PixiJS 版本锁定**: 使用特定 dev 版本 `8.14.0-dev.15bd3d9`，不要随意升级
- **Rust 编译优化**: dev profile 对核心 crate 使用 `opt-level = 2`，首次编译较慢
- **draw 窗口生命周期**: 截图完成后 draw 窗口进入 `WaitRelease` → 16s debounce → `Release` → 创建新窗口 → 关闭旧窗口
- **单实例**: 通过 `tauri-plugin-single-instance` 确保只有一个实例运行
- **自动启动**: `--auto_start` 参数触发时延迟 10s（Windows）/ 3s（macOS）启动
- **Windows 专用**: SharedBufferService（WebView 共享缓冲区）、bitmap 剪贴板写入
- **macOS 专用**: ActivationPolicy::Prohibited（不在 Dock 显示）

## Rust 编译警告（已知）

以下警告不影响功能，可忽略：
- `app-utils/src/lib.rs`: 未使用的导入 `IntoParallelRefIterator`
- `scroll_screenshot_service.rs`: 变量 `index_params` 赋值后未使用
