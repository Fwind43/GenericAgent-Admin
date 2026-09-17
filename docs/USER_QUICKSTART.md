# GenericAgent Admin Go 用户快速开始（v0.1.0-alpha）

> 本文面向希望用 GA Admin 管理本地 GenericAgent 实例的用户、维护者和 agent worker 协作管理员。本文描述 v0.1.0-alpha 具备的产品能力；正式 v0.1.0 仍以后续发布说明为准。

## 1. 启动前先确认

1. 准备一个已有的 GenericAgent 根目录，或在首次配置页选择安装到新目录。
2. 不要把私有文件放进源码或发布包：`config.local.json`、`model_profiles.json`、`mykey.py`、`.env`、`*.key`、Token、Cookie 都应只留在本机。
3. 管理端的写入、删除、停止/启动服务、保存模型密钥等动作属于高风险操作；前端会要求显式确认，后端写接口使用 `X-GA-Confirm: dangerous` 保护。

## 2. 首次配置与总览

- 在首次配置页填写或选择 GA 根目录，验证通过后进入控制台。
- “总览”用于查看运行状态、核心文件、最近报告、健康检查和风险摘要。
- 如果健康检查出现警告，先阅读页面给出的风险说明，再决定是否执行写入或服务操作。

相关代码路径：`web/src/App.jsx`、`web/src/lib/observability.js`。

<a id="project-modes"></a>

## 项目模式：官方与 Admin L1–L3

> 本节补充当前项目模式功能，不属于本文早期 v0.1.0-alpha 的能力描述；请以所安装版本是否提供该设置为准。

### 设置入口与选择建议

1. 打开**聊天设置**，找到**项目模式**。
2. 在**全局运行模式**中选择**官方项目模式**或 **Admin 项目模式（L1–L3）**。
3. 点击**保存**；出现“已保存，所有项目从下一轮起使用所选模式。”后生效。

两者的区别是**项目记忆如何组织和提供给 AI**，不是切换模型、推理强度或权限等级：

- **官方项目模式**：沿用 GenericAgent 官方项目机制，项目记忆使用 `project_memory.md`。希望保持官方使用习惯时选择。
- **Admin 项目模式（L1–L3）**：使用 Admin 提供的分层项目记忆，适合需要持续积累规则、知识和操作流程的长期项目。L1–L3 是记忆层级，不是模型能力等级。

### Admin 的三层记忆

| 层级 | 用途 | 项目内位置 |
| :--- | :--- | :--- |
| **L1：常驻规则与索引** | 随模型请求注入，保存精简规则和知识入口 | `memory/project_mem_insight.txt` |
| **L2：项目知识** | 按需读取当前有效的项目事实与约定 | `memory/project_mem.txt` |
| **L3：专题流程** | 按需读取具体专题的 SOP、经验与工具用法 | `memory/` 下的专题文件 |

这些路径位于 GA 根目录的 `temp/projects/<项目ID>/` 下；官方记忆为同一项目目录下的 `project_memory.md`。Admin 还提供写入记忆前需读取的 `memory/memory_management_sop.md`，项目不设 L4。

正常在项目内对话表达要求，由 Agent 按记忆规则维护，不需要日常手动整理分层文件。项目 L1 与全局规则共同提供给模型，不把项目知识写入全局记忆文件。

### 切换后会发生什么

- **全局生效，不只是新建项目**：保存后，已有项目和新项目的后续轮次均使用所选模式；正在执行的轮次仍使用派发时的模式。
- **不改变执行目录**：项目记忆目录与会话执行工作目录是不同概念；切换模式不会重写已有工作目录。
- **两套记忆分别保留**：初始化只补充缺失文件，不因切换覆盖已有内容，也不要求删除或禁用官方项目插件。
- **保留不等于同步**：切换不会自动全量转换或双向同步知识。Admin 会提供官方 `project_memory.md` 的来源信息，供 Agent 按需读取、提炼；Admin 中新增的知识也不会因切回官方模式自动写回官方记忆。

相关实现：`web/src/components/ProjectModeSetting.jsx`、`internal/api/chat_project_memory.go`、`cmd/chat_worker.py`。

## 3. 模型配置与本地密钥

“模型”页用于生成或维护本地 `mykey.py`：

1. 点击导入/新增模型配置。
2. 填写变量名、类型、显示名、模型名、API Base、API Key、超时和重试等字段。
3. 先预览生成内容，再写回 GA 根目录的 `mykey.py`。

安全与校验规则：

- 变量名必须是 Python 标识符，并包含 `api`、`config` 或 `cookie` 等可发现关键词。
- 缺少名称、模型、API Base，或 API Base 协议异常，会被标为阻断项；修复红色校验项前不能写回。
- API Key 为空只适用于本地或无需鉴权的端点；真实密钥不要提交到仓库，也不要随发布包分发。

相关代码路径：`web/src/pages/ModelsPage.jsx`、`web/src/lib/modelsValidation.js`。

## 4. 文件浏览、搜索、保存与删除

“文件”页用于在 GA 根目录内安全查看文本文件：

- 输入 GA 根目录或子目录后点击读取；空目录、未选择根目录、搜索无结果时会显示引导提示。
- 可读取文件、tail 日志、搜索文本、编辑并保存文件。
- 保存前页面会提示当前编辑内容是否已变更、加载文件路径和保存目标是否一致。
- 删除属于危险操作，只应删除确认过的 GA 根目录内文件；不要用管理端处理系统目录或未知路径。

已知边界：文件功能面向文本和日志排障，不替代完整 IDE；下载、打开、删除等动作仍需用户确认路径是否正确。

相关代码路径：`web/src/pages/FilesPage.jsx`、`internal/api/files.go`。

## 5. 服务与进程保护

“服务”页用于查看服务域、前端/通道、自主任务等运行状态，并按需执行启动、停止、日志查看或自启动配置。

安全提醒：

- 停止进程、启动 worker、修改自启动都可能影响正在运行的任务。
- 先查看服务名、PID、日志和页面风险提示；不确定时只读观察，不执行 stop/start。
- 危险操作必须经过显式确认和后端危险头保护。

相关代码路径：`web/src/components/common.jsx`、`web/src/components/ProcessGuard.jsx`、`web/src/App.jsx`。

## 6. 定时任务

“定时”页用于查看和维护计划任务：

- 可查看任务启用状态、运行间隔、下次运行信息和最近产物。
- 新建或修改任务前，确认命令、工作目录和产物路径都在预期范围内。
- 删除或禁用任务会影响自动化流程；建议先导出或记录原配置。

相关代码路径：`web/src/components/schedule.jsx`、`web/src/lib/schedule.js`。

## 7. Hive 模式与外置协作

GA Admin 不内置 BBS，也不再提供 `/api/bbs/*` 页面协议。需要多 worker 协作时，请使用 GA 官方 Hive 流程：

- 在 Goal 页面勾选 “Hive 模式” 后启动目标，Admin 会按 GA 官方逻辑创建 Hive 工作目录、启动外置 BBS、Master 和首个 worker。
- 也可在 GA 根目录外置启动 `assets/agent_bbs.py --cwd temp/hive_<目标短名> --port <PORT> --key <BOARD_KEY>`。
- 访问 `http://127.0.0.1:<PORT>/readme?key=<BOARD_KEY>` 查看官方 BBS 协议。
- worker 通过 `agentmain.py --reflect reflect/agent_team_worker.py --base_url http://127.0.0.1:<PORT> --board_key <BOARD_KEY>` 接入。
- Admin 的 Hive/Goal 页面只负责复用 GA 官方逻辑，不保存 board key、不托管帖子/回复。

## 8. Inventory / Risk / Health

总览会把后端健康、库存和风险信息聚合成用户可读状态：

- Inventory：GA 根目录、核心文件、记忆层、SOP/工具、服务域等盘点信息。
- Risk：涉及写入、删除、安装、拉取、保存、停止、启动等动作的风险摘要。
- Health：检查项、警告、错误、生成时间和根目录状态。

建议把这些信息作为操作前检查清单：先读风险，再执行写操作；发现错误时先修复根目录或配置问题。

相关代码路径：`web/src/lib/observability.js`、`web/src/App.jsx`。

## 9. 版本与更新安全

版本信息由后端注入，前端不应硬编码 `v0.1.0`。更新流程应遵守以下边界：

- 本地 RC 通过不等于远程发布完成。
- 只有 release owner 明确批准后，才能 commit、tag、push、创建 Release 或覆盖资产。
- 发布后需要确认 `ga-admin-<tag>-<goos>-<goarch>.zip` 与对应 `.sha256` 均可发现、下载并通过校验。
- 若已有同名 GitHub/GitCode 资产，覆盖必须另行批准。

相关代码路径：`internal/version/version.go`、`RELEASE_NOTES_v0.1.0.md`。

## 10. Ordinary-user non-chat acceptance matrix

Use this matrix to review the non-chat experience without publishing a remote release, writing real secrets, or restarting live services. It focuses on first-run expectations, empty/error states, and dangerous-operation boundaries.

| Area | First-run expectation | User-acceptable behavior | Low-risk evidence command |
| --- | --- | --- | --- |
| Files | Before a GA root is configured, the page shows guidance. After a GA root is configured, file browsing is limited to that root. | Empty directories, no search results, read failures, save-target mismatch, and delete confirmations are explicit. Save/delete require the user to re-check the path. | `git grep -n "FilesPage" web/src internal/api`; `git grep -n "X-GA-Confirm" internal web/src` |
| Models | The app starts without bundled private keys. The Models page can create a draft and preview the generated local `mykey.py`. | Invalid variable names, missing model fields, or malformed API Base values block writeback. Real API keys remain local only. | `git grep -n "modelsValidation" web/src`; `git grep -n "mykey.py" README.md docs RELEASE_NOTES_v0.1.0.md` |
| Schedule | Missing or unreadable task data shows an empty/error state and does not auto-create tasks. | Create/update/delete/disable flows ask the user to review command, working directory, interval, and artifact paths before mutation. | `git grep -n "schedule" web/src internal` |
| Hive | Missing GA root or unavailable Goal/Hive scripts should surface as normal GA capability/setup issues. | Collaboration BBS is external GA official `assets/agent_bbs.py`; Admin must not store board keys or host posts/replies. | `git grep -n "agent_bbs.py" README.md docs`; `git grep -n "/api/bbs" web/src internal` |
| Process / Observability | Overview shows health, risk, inventory, and service state before action; displayed PIDs may become stale. | Stop/start controls show name, PID/log context, and risk text. If unsure, the user can observe read-only state without stopping services. | `git grep -n "ProcessGuard" web/src`; `git grep -n "observability" web/src internal` |
| Release / Version | The UI reads version data from backend version APIs; alpha assets must still pass checksum/update verification. | Missing assets, network failures, or sha256 mismatch show recoverable errors and do not replace the running binary. | `git grep -n "internal/version" .`; `git grep -n "sha256" README.md docs RELEASE_NOTES_v0.1.0.md .github/workflows` |

Suggested documentation-level review:

1. Read sections 1-9 above and confirm a regular user can complete first root selection, file viewing, and model-preview setup without understanding Goal/Hive internals.
2. Run the evidence commands in the matrix to confirm each documented capability has a traceable source or documentation entry.
3. Run `git diff --check -- README.md CHANGELOG.md RELEASE_NOTES_v0.1.0.md docs/USER_QUICKSTART.md docs/RELEASE_MANIFEST_v0.1.0.md` to check whitespace.
4. Run `git status --short -- README.md CHANGELOG.md RELEASE_NOTES_v0.1.0.md docs` to confirm documentation changes are intentional.
5. Do not overwrite existing assets, restart services, or write real secrets without separate approval.

## 11. 常见限制

- 本文不覆盖聊天质量、模型供应商可用性或外部网络稳定性。
- 管理端不应成为密钥仓库；它只帮助生成本地配置。
- 对生产服务执行 stop/start、删除文件、修改计划任务前，请先备份并确认无人依赖当前进程。
- 当前说明为 v0.1.0-alpha 用户文档；正式 v0.1.0 以后续 release owner 批准和发布记录为准。
