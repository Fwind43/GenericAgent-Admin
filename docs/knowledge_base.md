# GenericAgent-Admin 知识库

> 基于 GitNexus 索引分析 (168 files / 6023 symbols / 14280 edges / 166 clusters / 300 flows)
> 索引日期: 2026-06-15 | Commit: 941d1b2

---

## 一、项目概览

| 属性 | 值 |
|------|-----|
| 定位 | GA Admin 管理面板 (Go 版) |
| 语言 | Go 1.23 + JSX (Vite) |
| 模块 | `genericagent-admin-go` |
| 唯一外部依赖 | `github.com/getlantern/systray v1.2.2` |
| 目录结构 | `main.go` + `internal/` (7子包) + `web/` (Vite前端) + `cmd/` (Python辅助) |

**一句话**: 一个用 Go 标准库构建的Web 管理面板，通过 HTTP API 管理 GenericAgent (Python) 进程、文件、BBS、定时任务、自行更新。

---

## 二、目录结构

```
GenericAgent-Admin/
├── main.go                     # 入口: 解析参数 → 初始化和启动 → 信号处理
├── tray.go / tray_linux.go     # 系统托盘 (systray)
├── config.dev.json             # 开发配置 (ga_root, host, port, ...)
├── config.example.json         # 配置模板
├── build.bat                   # Windows 构建脚本
├── go.mod / go.sum             # Go 模块
│
├── internal/
│   ├── api/              ★核心★ HTTP API (1025行) + 全面测试
│   │   ├── api.go               # Server struct, Routes() 注册, 中间件, risk catalog
│   │   ├── response.go          # writeJSON, bad, ok 等响应助手
│   │   ├── *_handlers.go        # 各领域 handler 实现
│   │   ├── *_test.go            # 测试 (30+ test functions)
│   │   └── chat_worker.go       # 聊天 worker 管理
│   │
│   ├── config/           # 配置持久化
│   │   └── config.go            # AppConfig struct, Store (JSON读写+验证)
│   │
│   ├── ga/               # GA 工作空间操作
│   │   ├── inventory.go         # 工作空间库存扫描 (core/files/frontend/plugins/memory)
│   │   ├── health.go            # 健康检查
│   │   ├── schedule.go          # 定时任务发现
│   │   ├── log.go / report.go   # 日志/报告收集
│   │   ├── goals.go             # Goal 管理
│   │   └── git.go               # Git 操作 (pull/status/mirror)
│   │
│   ├── service/          # 进程服务管理
│   │   └── service.go           # ServiceInfo, Manager (find/start/stop/logs)
│   │
│   ├── version/          # 自更新
│   │   └── version.go           # GitHub Releases 检查/下载/校验/应用/状态
│   │
│   │   ├── status.go            # 宠物安装状态检查
│   │   ├── export.go            # 宠物导出
│   │
│   ├── modelconfig/      # 模型配置
│   └── autostart/        # 开机自启 (Windows/Linux)
│
├── web/                  # Vite + React 前端
│   ├── vite.config.js          # Vite 配置 (proxy 到后端)
│   ├── index.html              # SPA 入口
│   └── src/
│       ├── main.jsx / App.jsx  # 应用入口 + 路由
│       ├── ChatApp.jsx         # 聊天独立入口
│       ├── pages/              # 页面组件
│       │   ├── ChatPage.jsx, FilesPage.jsx, GoalsPage.jsx
│       │   ├── ModelsPage.jsx, BBSPage.jsx
│       │   └── ...
│       ├── components/         # 共享组件
│       │   ├── common.jsx, feedback.jsx
│       │   ├── ProcessGuard.jsx, schedule.jsx, turns.jsx
│       │   └── ...
│       └── lib/                # 前端库
│           ├── api.js                 # API 客户端 (fetch + dangerous confirm)
│           ├── format.js              # 格式化工具
│           ├── routing.js             # 前端路由
│           ├── bbsContract.js         # BBS API 约定
│           ├── chatTextSafety.js      # 聊天安全
│           ├── modelsValidation.js    # 模型验证
│           ├── observability.js       # 进程可观测性
│           ├── schedule.js            # 定时任务客户端
│           ├── danger.js              # 危险操作索引
│           └── *.test.mjs             # 前端合同测试
│
├── cmd/
│   └── chat_worker.py          # Python 聊天 worker (独立进程)
│
├── assets/
│
├── release/                    # 构建产物
└── temp/ / tmp/                # 临时文件
```

---

## 三、核心架构

### 3.1 启动流程 (main.go)

```
main()
 ├─ flag.Parse()                  # 解析命令行参数: -dir, -port, -host, -web, -tray
 ├─ config.NewStore(dir)          # 创建配置存储 (自动解析 config.dev.json)
 ├─ service.NewManager(cfg)       # 创建服务进程管理器
 ├─ modelconfig.NewStore(cfg)     # 创建模型配置管理
 ├─ api.New(cfg, svc, models, web/)  # 创建 HTTP Server
 ├─ if tray → systray.Run()      # 系统托盘模式
 └─ else → http.ListenAndServe()  # 直接 HTTP 模式
```

### 3.2 HTTP 路由全景 (api.go: Routes)

**中间件链**: `recoverPanics → cors → mux`

#### 路由分类:

| 类别 | 路由前缀 | 数量 | 说明 |
|------|---------|------|------|
| 健康/版本 | `/api/health`, `/api/version/*` | 5 | 健康检查 + 版本信息 + 自更新 |
| GA 工作空间 | `/api/ga/*` | 7 | inventory, health, llms, git, processes |
| 文件管理 | `/api/files/*` | 8 | list, read, write, delete, download, tail, search, open, image |
| 服务管理 | `/api/services/*` | 5 | list, summary, start, stop, autostart |
| 定时任务 | `/api/schedule/*` | 6 | tasks, task CRUD, toggle, artifact |
| Goals | `/api/goals/*` | 4 | start, list, stop, delete, output |
| 模型配置 | `/api/models/*` | 5 | CRUD + preview + import/export |
| 聊天 | `/api/chat/*` | 2 | sessions + SSE handler |
| BBS | `/api/bbs/*` | 6+3 | status, config, posts, reply, readme (含兼容路由) |
| 环境安装 | `/api/setup/*` | 4 | env, browse, validate, install |
| 开机自启 | `/api/autostart/*` | 2 | enable, disable |
| 浏览器驱动 | `/api/tmwebdriver/*` | 3 | status, repair, install-deps |
| 通道测试 | `/api/channels/*` | 2 | test + CRUD |
| 自动运行 | `/api/autonomous/*` | 1 | start |
| 风险目录 | `/api/risk/catalog` | 1 | 列出所有危险路由 |
| 配置 | `/api/config` | 1 | 读写配置 |

### 3.3 Danger Confirm 安全机制

**模式**: 所有危险操作必须携带 `X-GA-Confirm: dangerous` HTTP 头。

```go
// api.go
mux.HandleFunc("/api/files/write", s.requireDangerousConfirm(s.filesWrite))

// 中间件逻辑:
func (s *Server) requireDangerousConfirm(next http.HandlerFunc) http.HandlerFunc {
    // 检查 X-GA-Confirm header == "dangerous"
    // 不通过 → 返回 riskCatalog 提示
}
```

**前端对应** (`web/src/lib/api.js`):
```js
const api = async (url, { dangerous = false, ... } = {}) => {
    const req = { headers: apiHeaders({ dangerous, ... }) }
    // dangerous=true 时自动添加 X-GA-Confirm: dangerous
}
```

**风险级别**:
- `dangerous`: 不可逆破坏操作 (文件删除, Git pull, 自更新...)
- `reversible`: 可逆但需谨慎 (配置修改, 服务启停...)

---

## 四、关键设计模式

### 4.1 工作空间库存与健康聚合

`internal/ga/inventory.go` 和 `internal/ga/health.go` 分别提供工作空间扫描与健康检查：

```go
inventory := ga.BuildInventory(root)
health := ga.BuildHealth(root)
```

**用途**: 总览按需读取稳定的库存与健康数据；两条能力链彼此独立，避免为单个页面引入额外的聚合状态对象。

### 4.2 服务管理 (进程生命周期)

`internal/service/service.go` 管理 GA Python 子进程：

```
Manager.Find(name)       → ServiceInfo
Manager.Start(name)      → 启动子进程，记录 PID
Manager.Stop(name)       → 优雅停止 (SIGINT → SIGKILL 级联)
Manager.Logs(name, tail) → 读取进程日志
Manager.Summary()        → 汇总统计
```

**特点**: 使用 `os.StartProcess` 直接管理，通过 PID 检查存活状态。

### 4.3 原子文件写入

```go
// config.go & version.go 共用模式:
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
    dir := filepath.Dir(path)
    tmp, _ := os.CreateTemp(dir, "."+filepath.Base(path)+"-*.tmp")
    tmp.Write(data)
    tmp.Close()
    os.Rename(tmp.Name(), path)   // 原子重命名
    return nil
}
```

### 4.4 自更新机制 (GitHub Releases)

`internal/version/version.go` 完整自更新流程：

```
CheckUpdate()  → GET GitHub API releases/latest
  ├─ 对比版本号
  ├─ 匹配 OS/ARCH 的 asset
  └─ 返回 CheckResult{Update: bool, Asset: ...}

ApplyUpdate()  → 异步执行
  ├─ 下载 release zip
  ├─ SHA256 校验
  ├─ 解压到临时目录
  ├─ 写入更新脚本
  ├─ 停止当前服务
  ├─ 替换可执行文件
  └─ 重新启动
```

平台范围为 Windows、Linux，以及 macOS 的 `darwin-amd64`/`darwin-arm64` 官方 ZIP 包。Linux/macOS 共用基于 `/bin/sh` 的 Unix 替换脚本，并以位置参数传递安装路径、旧进程 PID 和原启动参数，避免空格或 shell 特殊字符破坏路径；脚本会等待旧进程释放端口，并将重启日志写入临时更新目录的 `apply-update.log`。安装目录必须对当前用户可写；此流程不替换 `.app` bundle，也不管理 Homebrew、代码签名或公证。

**状态文件**: `ga-admin-update-status.json` (持久化更新进度，支持进程重启后恢复)。

### 4.5 前后端合同测试

Go 端 (`internal/api/non_chat_contract_test.go`):
```go
func TestNonChatStatusEndpointsReturnStableJSONObjects(t *testing.T) {
    // 遍历所有 GET 路由，验证:
    // 1. 非 GET 请求被拒绝
    // 2. 返回稳定的 JSON 对象
    // 3. 危险路由需要 confirm header
}
```

JS 端 (`web/src/lib/dangerous_api_contract.test.mjs`):
```js
// 验证 frontend danger.js 和 backend riskCatalog 一致性
// 确保新增危险路由两端都有记录
```

---

## 五、Go 代码风格规范

### 5.1 命名约定
- **包名**: 全小写，简短 (api, config, ga, service, version)
- **导出类型**: PascalCase (`Server`, `AppConfig`, `Inventory`, `Health`, `ServiceInfo`)
- **未导出函数**: camelCase (`buildMemory`, `readStatusLocked`)
- **JSON 标签**: snake_case (`json:"ga_root"`)
- **测试函数**: `Test` + PascalCase (TestDangerousConfirmWrapperRejectsMissingHeader)

### 5.2 错误处理
```go
if err != nil {
    bad(w, http.StatusInternalServerError, "描述: "+err.Error())
    return
}
```
- 使用 `errors.New()` / `fmt.Errorf()` 创建错误
- API 层统一通过 `bad()` / `writeJSON()` 返回
- 不 panic (除 middleware 的 recover)

### 5.3 结构体设计
```go
type Server struct {
    CfgStore    *config.Store       // 依赖注入
    Svc         *service.Manager    // ...
    Models      *modelconfig.Store
    Static      fs.FS               // 嵌入文件系统
    ChatMu      sync.Mutex          // 并发保护
    ChatRuns    map[string]*chatRun
}
```

### 5.4 导入分组
```go
import (
    "context"       // 标准库
    "fmt"
    
    "genericagent-admin-go/internal/config"  // 内部包
    "genericagent-admin-go/internal/ga"
)
```

---

## 六、前端代码风格规范

### 6.1 API 客户端
```js
// api.js - 统一的 fetch 封装
const api = async (url, options = {}) => {
    const { dangerous = false, ...rest } = options
    const req = { ...rest, headers: apiHeaders({ dangerous, ... }) }
    return parseApiResponse(await fetch(url, req), url)
}
```

### 6.2 合同测试
```js
// *.test.mjs - 验证前后端约定
export const dangerousHeaderRoutes = [
    "/api/files/write", "/api/files/delete", ...
]
// 测试确保与 Go 端 riskCatalog 一致
```

### 6.3 组件模式 (JSX)
- 页面组件在 `pages/` 下
- 共享 UI 组件在 `components/` 下
- 工具函数在 `lib/` 下，每个文件一个职责

---

## 七、构建与运行

### 开发模式
```bash
# Go 后端
go run . -dir /path/to/GenericAgent -port 13838

# 前端热重载 (开发时)
cd web && npx vite --port 5173

# 或使用 build.bat 构建
build.bat
```

### 配置
```json
{
    "ga_root": "E:/Work/GenericAgent",
    "host": "127.0.0.1",
    "port": 8787,
    "log_tail_lines": 200,
    "buffer_lines": 1000,
    "service_autostart": []
}
```

### 环境变量
- `GA_ADMIN_PORT` - 覆盖配置端口
- `GA_ADMIN_HOST` - 覆盖配置主机

---

## 八、二次开发切入点

### 新增 API 路由
1. 在 `internal/api/api.go` 的 `Routes()` 注册
2. 在对应 `*_handlers.go` 实现 handler
3. 危险操作：用 `s.requireDangerousConfirm()` 包裹
4. 在 `riskCatalogItems` 添加条目
5. 编写测试 (`*_test.go`)
6. 前端: 在 `web/src/lib/api.js` 调用，危险操作传 `{dangerous: true}`

### 新增配置项
1. 在 `internal/config/config.go` 的 `AppConfig` 添加字段 + JSON tag
2. 在 `Validate()` 添加验证逻辑
3. 更新 `config.example.json`

### 新增前端页面
1. 在 `web/src/pages/` 创建页面组件
2. 在 `App.jsx` 注册路由
3. 在 `components/` 创建相关组件
4. 编写合同测试 (`.test.mjs`)

### 新增内部模块
1. 在 `internal/` 下创建新包
2. 保持单文件单职责
3. 导出类型和函数
4. 在 `api.go` 注入依赖到 `Server` struct
