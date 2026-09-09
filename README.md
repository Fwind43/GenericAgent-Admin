<div align="center">

# GenericAgent Admin Go

**Desktop Management Panel for GenericAgent**

*Go backend + React frontend · Single executable · Cross-platform*

<p>
  <a href="https://github.com/Fwind43/GenericAgent-Admin"><img src="https://img.shields.io/badge/Repository-GenericAgent--Admin-181717?style=flat-square&logo=github" alt="Repository"/></a>
  <a href="https://github.com/Fwind43/GenericAgent-Admin/releases/latest"><img src="https://img.shields.io/badge/Download-Latest_Release-00A67E?style=flat-square" alt="Latest Release"/></a>
  <a href="https://github.com/Lsdefine/GenericAgent"><img src="https://img.shields.io/badge/Upstream-GenericAgent-EA4335?style=flat-square" alt="GenericAgent"/></a>
</p>

**[English](#-english) · [中文](#-中文)**

</div>

> 📌 **Requires:** This admin panel manages local **[GenericAgent](https://github.com/Lsdefine/GenericAgent)** instances. Install GenericAgent first.

---

<a id="-english"></a>

## 🌟 Overview

**GenericAgent Admin Go** is a desktop management panel for GenericAgent. A Go backend handles processes, files, configuration, updates, and system integration, while a React/Vite frontend provides a control console. It packages into a single `ga-admin` / `ga-admin.exe` executable.

The goal is not to replace GenericAgent, but to consolidate local GA runtime state, task entry points, model configuration, team collaboration, and desktop assistance into a maintainable UI.

### 🖥️ See It in Action

<p align="center">
  <img src="docs/screenshots/chat-light.png" alt="GA Admin native chat - light theme" width="32%" />
  <img src="docs/screenshots/chat-warm.png" alt="GA Admin native chat - warm theme" width="32%" />
  <img src="docs/screenshots/chat-dark.png" alt="GA Admin native chat - dark theme" width="32%" />
</p>

*Native chat with instance switching, model selection, streaming replies, and usage tracking.*

### 📑 Table of Contents

- [Key Features](#-key-features)
- [Quick Start](#-quick-start)
- [Core Capabilities](#-core-capabilities)
- [Development](#-development)
- [Release](#-release)
- [Documentation](#-documentation)
- [Upstream](#-upstream)
- [License](#-license)

---

## 📋 Key Features

| Feature | Description |
| :--- | :--- |
| 📊 **Dashboard** | Overview of service status, recent activity, system stats |
| 💬 **Native Chat** | Chat interface with `/chat` entrypoint, streaming response, usage tracking, model switching |
| 📝 **File Editor** | Browse GA root, edit skills/SOPs/configs, syntax highlighting, file tree |
| 📋 **Task Management** | Services (start/stop worker), scheduled tasks, Goal runs, autonomous reports |
| 🧠 **Memory Browser** | View/search global and project memory |
| 📡 **Channel Monitor** | Active channels, message logs |
| 🤖 **Autonomous Mode** | Background task execution |
| 📈 **Usage Tracking** | Token/cost statistics per model |
| 🎯 **Goal Mode** | Start/stop long-running goals, view logs/status |
| ⚙️ **Model Config** | Wizard to add models, test endpoints, manage profiles |
| 🔧 **Settings** | App config, auth, ga_root path |
| 📄 **Log Viewer** | Tail worker logs, search history |

---

## 📈 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Fwind43/GenericAgent-Admin&type=Date)](https://star-history.com/#Fwind43/GenericAgent-Admin&Date)

---

## 🚀 Quick Start

> ⚠️ **Prerequisites:** Python 3.11+ (for GenericAgent), Node.js 18+ / Go 1.22+ (for development builds)

### For LLM Agents

Fetch installation guide and follow:

```bash
curl -fsSL https://raw.githubusercontent.com/Fwind43/GenericAgent-Admin/main/README.md
```

### For Human Users

#### Method 1 — Download Release Package *(Recommended)*

Download the platform-specific package from [GitHub Releases](https://github.com/Fwind43/GenericAgent-Admin/releases/latest):

```
ga-admin-windows-amd64.zip
ga-admin-linux-amd64.tar.gz
ga-admin-darwin-amd64.tar.gz  (macOS Intel)
ga-admin-darwin-arm64.tar.gz  (macOS Apple Silicon)
```

Extract and create `config.local.json` in the same directory:

```json
{
  "ga_root": "E:/Work/GenericAgent"
}
```

**Windows:** Double-click `ga-admin.exe`. The UI opens in a native desktop window backed by the WebView2 runtime (preinstalled on Windows 11 and current Windows 10), and the app keeps running in the system tray after you close the window. Run `ga-admin.exe --no-window` to use your default browser instead, or `ga-admin.exe --no-browser` to start without opening any UI.
**macOS:** Run `./ga-admin`. The UI opens in a native desktop window backed by WKWebView (built into macOS). Closing the window keeps the app in the menu bar. Use `--no-window` to open your default browser instead, or `--no-browser` to start without opening any UI.
**Linux:** Run `./ga-admin` or `./ga-admin --no-browser`. Linux still opens the UI in your default browser.

By default the server listens on `127.0.0.1` with a random port, so nothing is exposed to the network and local access needs no password. The address of the running process is printed at startup and written to `runtime.local.json`; open that URL if you want a second view of the UI. To reach the admin server from another device, turn on remote access in **Settings** (see [Remote access](#remote-access)).

#### Method 2 — Local Development Build

```bash
cd GenericAgent-Admin-Go
npm --prefix web install
npm --prefix web run build
go run .
```

Open the URL printed on startup, or run `go run . --port 8787` to pin a loopback port. The Vite dev server (`npm --prefix web run dev`) proxies `/api` to the port recorded in `runtime.local.json`, so it follows the random port automatically.

---

## 🎯 Core Capabilities

### For Daily Users

- **Service Management:** Start/stop worker, monitor logs, check process status
- **Chat Interface:** `/chat` entrypoint with streaming, usage tracking, model switching

### Choosing an Autonomy Mode

Three features keep an agent working without new input. They are not interchangeable:

| Mode | Runs in | Decides "done" |
| :--- | :--- | :--- |
| **Loop** (chat rail) | The open chat session | A separate controller model, once per round |
| **Goal Mode** | A detached GA process with its own state dir | GA's `reflect/goal_mode.py` |
| **UltraPlan** (`/ultraplan`) | A single turn's tool loop | The main agent itself |

Pick Loop when you want to watch and interrupt, and everything to stay in one thread; Goal Mode when the job is long and nobody needs to sit with it; UltraPlan when one multi-phase plan can be carried by the agent alone.

Loop spends one extra full-context controller call per round, so keep the round limit tight. It stops itself at the round limit, when the controller asks for the same next step twice in a row, or when you press stop.

### Conductor: delegated work and delivery review

Use Conductor when a parent task should delegate bounded work to child sessions and collect their results. Unlike Loop's round controller, Conductor coordinates parent/worker sessions; execution completion is not delivery verification.

- Successful execution starts as **Pending review**. **Verified (parent review)** requires a review basis and references to persisted tool evidence belonging to that dispatch. **Needs work** records an unsuccessful review. Worker prose alone cannot satisfy the evidence requirement; parent review is not an independent guarantee of correctness. Inspect the basis, tool records, and unverified boundaries.
- The parent workspace shows input/output tokens for the parent, finalized child snapshots, and their recorded total. Missing snapshots are not zero usage. Running usage is incomplete; child totals include only saved terminal snapshots, not live consumption or a billing estimate.
- Each parent session accepts at most **48 cumulative dispatches**, including reused workers and completed, failed, or cancelled dispatches. Dispatch 49 is rejected before session mutation. This is a dispatch-count limit, not a token, cost, or wall-clock budget. Existing concurrency (3 running) and nonterminal (12) limits still apply.

### For Administrators

- **Goal Mode:** Persistent goals (JSON), BBS team board, sync UI
- **File Operations:** Browse GA root, edit skills/SOPs/configs, create/rename/delete
- **Models:** Add/test/remove model profiles, wizard UI
- **Updates:** Check GitHub Releases, download & apply platform-specific packages

### For Developers

- **Frontend:** React 18 + Vite 6, code-split routes, theme toggle, accessibility
- **Backend:** Go 1.22+, embedded web assets (`//go:embed web/dist`), subprocess lifecycle
- **Build:** Single-executable distribution, GitHub Actions CI/CD for 6 platforms
- **Test:** `npm run verify` (lint + test:lib + build), `go test ./...`

---

## 🛠️ Development

### CLI Flags

- `--headless` / `--server-only` / `--no-browser`: Run without opening browser
- `--no-window`: Use the system browser instead of the native desktop window (Windows and macOS; Linux always uses the browser)
- `--app-root <path>`: Override GA root directory (default: from `config.local.json`)
- `--port <port>`: Pin the listen port for this launch instead of the random loopback port

### Environment Variables

- `GA_ADMIN_AUTH_USER` / `GA_ADMIN_AUTH_PASSWORD`: Fix the credential for remote access. When both are set the password cannot be changed from the UI.
- `GA_ADMIN_NO_WINDOW`: Same as `--no-window`

### Remote access

The admin server can run processes and read and write files, so it stays on loopback unless you opt out:

- **Default.** Binds `127.0.0.1` on a random port. Requests from this machine never need a password, and no other device can connect.
- **Remote access on, password required.** Binds every interface on `port`. Remote clients must authenticate with HTTP Basic Auth; local requests still skip it. Set the password in **Settings → Remote access** first — a launch that requires a password without having one falls back to loopback and logs why.
- **Remote access on, anonymous allowed.** Binds every interface with no authentication at all. Only appropriate on a network you fully trust.

Changes to the listen address take effect on the next start. Each run records where it actually bound in `runtime.local.json` (URL, address, port, PID); the file is removed on a clean shutdown and overwritten on the next start.

### Configuration

Place `config.local.json` in the executable directory:

```json
{
  "ga_root": "/path/to/GenericAgent",
  "remote_access": false,
  "remote_allow_anonymous": false,
  "port": 8787,
  "service_autostart": ["worker"],
  "slash_commands": [
    {"cmd": "/plan", "desc": "Call plan_worker.py for multi-step planning"}
  ]
}
```

`host` and `port` only apply while `remote_access` is `true`; a loopback launch always takes a random port. See `config.example.json` for all available options.

The repository ignores:

```
config.local.json
*.local.json
model_profiles.json
dist/
*.exe
web/node_modules/
/temp/
/release/
*.pid
*.log
```

### Validation Before Commit

Run at least:

```bash
npm --prefix web run verify    # lint + test:lib + build
go test ./...
go build ./...
git diff --check
```

**Notes:**
- `npm run verify` runs `lint + test:lib + build` (skips `test:ui`)
- `web/src/lib/*.test.mjs` are auto-discovered by `npm run test:lib`
- Test files do not need `package.json` registration
- After changing `internal/appicon/assets/tray_windows.ico`, run `go generate .` to rebuild the committed `rsrc_windows_*.syso` files that give the Windows executable its icon

---

## 📦 Release

1. **Verify clean state:** No uncommitted changes, all tests pass
2. **Run validation:** `npm --prefix web run verify && go test ./...`
3. **Commit & tag:** `git commit -am "release: v0.x.x"` → `git tag v0.x.x`
4. **Push:** `git push origin main --tags`

GitHub Actions will build 6 platform packages and attach to the release:

```
ga-admin-windows-amd64.zip
ga-admin-windows-arm64.zip
ga-admin-linux-amd64.tar.gz
ga-admin-linux-arm64.tar.gz
ga-admin-darwin-amd64.tar.gz
ga-admin-darwin-arm64.tar.gz
```

Each package includes:
- Platform-specific executable (`ga-admin` / `ga-admin.exe`)
- `config.example.json` template
- Version metadata (injected via `-ldflags` during build)

---

## 📄 Documentation

- User-focused quickstart: [`docs/USER_QUICKSTART.md`](docs/USER_QUICKSTART.md) (Chinese)
- Knowledge base: [`docs/knowledge_base.md`](docs/knowledge_base.md)
- Developer experience: [`docs/secondary_dev_experience.md`](docs/secondary_dev_experience.md)

---

## 🔗 Upstream

This project manages local **[GenericAgent](https://github.com/Lsdefine/GenericAgent)** instances. GA Admin requires a GenericAgent installation to function.

---

## 📄 License

This project is used internally within the GenericAgent ecosystem. For external distribution, confirm upstream GenericAgent and dependency project license requirements first.

---

<a id="-中文"></a>

## 🌟 项目简介

**GenericAgent Admin Go** 是 GenericAgent 的桌面管理面板。Go 后端负责进程、文件、配置、更新和系统集成，React/Vite 前端提供控制台界面。打包为单个 `ga-admin` / `ga-admin.exe` 可执行文件。

目标不是替代 GenericAgent，而是将本地 GA 运行状态、任务入口、模型配置、团队协作和桌面辅助整合到一个可维护的 UI 中。

### 🖥️ 界面预览

<p align="center">
  <img src="docs/screenshots/chat-light.png" alt="GA Admin 原生聊天 - 浅色主题" width="32%" />
  <img src="docs/screenshots/chat-warm.png" alt="GA Admin 原生聊天 - 暖色主题" width="32%" />
  <img src="docs/screenshots/chat-dark.png" alt="GA Admin 原生聊天 - 深色主题" width="32%" />
</p>

*支持实例切换、模型选择、流式回复与用量跟踪的原生聊天界面。*

### 📑 目录

- [核心特性](#-核心特性)
- [快速开始](#-快速开始)
- [核心功能](#-核心功能)
- [开发](#-开发)
- [发布](#-发布)
- [文档](#-文档)
- [上游项目](#-上游项目)
- [许可](#-许可)

---

## 📋 核心特性

| 特性 | 说明 |
| :--- | :--- |
| 📊 **仪表盘** | 服务状态概览、最近活动、系统统计 |
| 💬 **原生聊天** | `/chat` 入口的聊天界面，流式响应，用量跟踪，模型切换 |
| 📝 **文件编辑器** | 浏览 GA 根目录，编辑技能/SOP/配置，语法高亮，文件树 |
| 📋 **任务管理** | 服务（启动/停止 worker）、计划任务、Goal 运行、自主报告 |
| 🧠 **记忆浏览器** | 查看/搜索全局和项目记忆 |
| 📡 **通道监控** | 活动通道、消息日志 |
| 🤖 **自主模式** | 后台任务执行 |
| 📈 **用量跟踪** | 每个模型的 Token/成本统计 |
| 🎯 **Goal 模式** | 启动/停止长时间运行的目标，查看日志/状态 |
| ⚙️ **模型配置** | 添加模型的向导，测试端点，管理配置文件 |
| 🔧 **设置** | 应用配置、认证、ga_root 路径 |
| 📄 **日志查看器** | 尾随 worker 日志，搜索历史 |

---

## 📈 Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=Fwind43/GenericAgent-Admin&type=Date)](https://star-history.com/#Fwind43/GenericAgent-Admin&Date)

---

## 🚀 快速开始

> ⚠️ **前置要求：** Python 3.11+（用于 GenericAgent），Node.js 18+ / Go 1.22+（用于开发构建）

### 给 LLM Agent 看的

获取安装指南并照做：

```bash
curl -fsSL https://raw.githubusercontent.com/Fwind43/GenericAgent-Admin/main/README.md
```

### 给人类用户看的

#### 方法一 — 下载发布包 *（推荐）*

从 [GitHub Releases](https://github.com/Fwind43/GenericAgent-Admin/releases/latest) 下载平台特定包：

```
ga-admin-windows-amd64.zip
ga-admin-linux-amd64.tar.gz
ga-admin-darwin-amd64.tar.gz  (macOS Intel)
ga-admin-darwin-arm64.tar.gz  (macOS Apple Silicon)
```

解压后在同目录创建 `config.local.json`：

```json
{
  "ga_root": "E:/Work/GenericAgent"
}
```

**Windows：** 双击 `ga-admin.exe`。界面会在原生桌面窗口中打开（基于 WebView2 运行时，Windows 11 与较新的 Windows 10 已预装），关闭窗口后程序继续驻留系统托盘。加 `--no-window` 可改用默认浏览器打开，加 `--no-browser` 则启动时不打开任何界面。
**macOS：** 运行 `./ga-admin`。界面会在原生桌面窗口中打开（基于系统自带的 WKWebView）。关闭窗口后程序继续留在菜单栏。加 `--no-window` 可改用默认浏览器打开，加 `--no-browser` 则启动时不打开任何界面。
**Linux：** 运行 `./ga-admin` 或 `./ga-admin --no-browser`，Linux 仍使用默认浏览器打开界面。

默认监听 `127.0.0.1` 的随机端口：不对外暴露，本机访问也不需要密码。实际地址会在启动日志中打印，同时写入 `runtime.local.json`；需要再开一个界面视图时用它。要从其它设备访问，请在**设置**中开启远程访问（见[远程访问](#远程访问)）。

#### 方法二 — 本地开发构建

```bash
cd GenericAgent-Admin-Go
npm --prefix web install
npm --prefix web run build
go run .
```

浏览器打开启动日志中给出的地址；若想固定本机端口，可运行 `go run . --port 8787`。Vite 开发服务器（`npm --prefix web run dev`）会把 `/api` 代理到 `runtime.local.json` 中记录的端口，因此随机端口也能自动跟上。

---

## 🎯 核心功能

### 面向日常用户

- **服务管理：** 启动/停止 worker，监控日志，检查进程状态
- **聊天界面：** `/chat` 入口，流式响应，用量跟踪，模型切换

### 三种自动推进模式怎么选

有三个功能都能让 Agent 在没有新输入的情况下继续干活，它们并不等价：

| 模式 | 运行位置 | 谁判断"做完了" |
| :--- | :--- | :--- |
| **Loop**（聊天右栏） | 当前打开的会话内 | 独立的控制模型，每轮判一次 |
| **Goal 模式** | 独立的 GA 进程，自带状态目录 | GA 自己的 `reflect/goal_mode.py` |
| **UltraPlan**（`/ultraplan`） | 单个 turn 的工具循环内 | 主 Agent 自己 |

想边看边随时介入、并且产物都留在同一条会话里，用 Loop；任务长、不需要盯着，用 Goal 模式；一个多阶段计划 Agent 自己就能扛下来，用 UltraPlan。

Loop 每轮会额外花一次全量上下文的控制模型调用，轮次上限别设太大。它会在达到轮次上限、控制模型连续两次给出同一个下一步、或你手动停止时自行结束。

### Conductor：任务分派与交付核验

需要父任务拆分工作、交给子会话执行并收集结果时使用 Conductor。它负责父子任务协作，不等同于 Loop 的逐轮控制；执行结束不代表成果已核验。

- 执行成功后默认**待核验**。**已核验（父任务审阅）**必须提供依据并引用本次派发已持久化的工具证据；**需返工**表示审阅未通过。worker 自述完成不能替代工具证据，父任务审阅也不是独立的正确性保证，请结合依据、工具记录和未验证边界判断。
- 父任务面板分列父任务、已封存子任务及已记录合计的输入/输出 Token。缺失快照不等于零消耗；运行中用量不完整，子任务仅计入已保存的终态快照，不是实时账单。
- 每个父会话累计最多接受 **48 次派发**，复用 worker 及已完成、失败、取消的派发均计数。第 49 次在修改会话前拒绝。这是派发次数上限，不是 Token、费用或运行时长预算；原有最多 3 个运行中、12 个未终结任务限制仍有效。

### 面向管理员

- **Goal 模式：** 持久化目标（JSON），BBS 团队看板，同步 UI
- **文件操作：** 浏览 GA 根目录，编辑技能/SOP/配置，创建/重命名/删除
- **模型管理：** 添加/测试/移除模型配置文件，向导 UI
- **更新：** 检查 GitHub Releases，下载并应用平台特定包

### 面向开发者

- **前端：** React 18 + Vite 6，路由代码分割，主题切换，无障碍
- **后端：** Go 1.22+，嵌入 web 资源（`//go:embed web/dist`），子进程生命周期
- **构建：** 单可执行文件分发，GitHub Actions CI/CD 支持 6 平台
- **测试：** `npm run verify`（lint + test:lib + build），`go test ./...`

---

## 🛠️ 开发

### CLI 参数

- `--headless` / `--server-only` / `--no-browser`：无浏览器模式运行
- `--no-window`：改用系统浏览器而非原生桌面窗口（Windows 与 macOS；Linux 始终用浏览器）
- `--app-root <路径>`：覆盖 GA 根目录（默认从 `config.local.json` 读取）
- `--port <端口>`：本次启动固定监听端口，替代默认的本机随机端口

### 环境变量

- `GA_ADMIN_AUTH_USER` / `GA_ADMIN_AUTH_PASSWORD`：固定远程访问使用的凭据；两者都设置后界面上无法再修改密码
- `GA_ADMIN_NO_WINDOW`：等同于 `--no-window`

### 远程访问

管理端可以执行进程、读写文件，因此默认只监听本机，需要显式放开：

- **默认。** 监听 `127.0.0.1` 的随机端口。本机请求永远不需要密码，其它设备也连不上。
- **开启远程访问 + 需要密码。** 在所有网卡上监听 `port`。远程客户端必须通过 HTTP Basic Auth 认证，本机请求仍然免密。请先在**设置 → 远程访问**中设置密码；若配置要求密码却没有设置，启动时会退回本机监听并在日志中说明原因。
- **开启远程访问 + 允许匿名。** 在所有网卡上监听且完全不做认证，只适合完全可信的网络。

监听地址的修改在下次启动时生效。每次运行都会把实际绑定信息（URL、地址、端口、PID）写入 `runtime.local.json`，正常退出时删除，下次启动时覆盖。

### 配置

在可执行文件目录放置 `config.local.json`：

```json
{
  "ga_root": "/path/to/GenericAgent",
  "remote_access": false,
  "remote_allow_anonymous": false,
  "port": 8787,
  "service_autostart": ["worker"],
  "slash_commands": [
    {"cmd": "/plan", "desc": "调用 plan_worker.py 进行多步规划"}
  ]
}
```

`host` 与 `port` 只在 `remote_access` 为 `true` 时生效；本机监听始终使用随机端口。参见 `config.example.json` 获取所有可用选项。

仓库忽略：

```
config.local.json
*.local.json
model_profiles.json
dist/
*.exe
web/node_modules/
/temp/
/release/
*.pid
*.log
```

### 提交前验证

至少运行：

```bash
npm --prefix web run verify    # lint + test:lib + build
go test ./...
go build ./...
git diff --check
```

**注意：**
- `npm run verify` 运行 `lint + test:lib + build`（跳过 `test:ui`）
- `web/src/lib/*.test.mjs` 由 `npm run test:lib` 自动发现
- 测试文件无需 `package.json` 注册
- 修改 `internal/appicon/assets/tray_windows.ico` 后运行 `go generate .`，重新生成随仓库提交的 `rsrc_windows_*.syso`（Windows 可执行文件的图标资源）

---

## 📦 发布

1. **验证清洁状态：** 无未提交更改，所有测试通过
2. **运行验证：** `npm --prefix web run verify && go test ./...`
3. **提交并打标签：** `git commit -am "release: v0.x.x"` → `git tag v0.x.x`
4. **推送：** `git push origin main --tags`

GitHub Actions 将构建 6 个平台包并附加到发布：

```
ga-admin-windows-amd64.zip
ga-admin-windows-arm64.zip
ga-admin-linux-amd64.tar.gz
ga-admin-linux-arm64.tar.gz
ga-admin-darwin-amd64.tar.gz
ga-admin-darwin-arm64.tar.gz
```

每个包包含：
- 平台特定可执行文件（`ga-admin` / `ga-admin.exe`）
- `config.example.json` 模板
- 版本元数据（构建时通过 `-ldflags` 注入）

---

## 📄 文档

- 用户快速开始：[`docs/USER_QUICKSTART.md`](docs/USER_QUICKSTART.md)（中文）
- 知识库：[`docs/knowledge_base.md`](docs/knowledge_base.md)
- 二次开发体验：[`docs/secondary_dev_experience.md`](docs/secondary_dev_experience.md)

---

## 🔗 上游项目

本项目管理本地 **[GenericAgent](https://github.com/Lsdefine/GenericAgent)** 实例。GA Admin 需要 GenericAgent 安装才能运行。

---

## 📄 许可

本项目在 GenericAgent 生态系统内部使用。如需外部分发，请先确认上游 GenericAgent 及依赖项目的许可要求。
