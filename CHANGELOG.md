# Changelog

This file records manually curated release changes for GenericAgent Admin Go.

## v0.3.20

- **更新入口与弹窗**：新增独立、按更新状态呈现的弹窗，可从 Chat 左上角版本号打开；区分更新说明、日志、下载及已准备状态，安装与重启仍需明确确认。
- **安全更新说明**：发布说明支持 Markdown 展示，过滤不安全的 HTML 与链接。
- **吞吐统计修复**：输出 tok/s 使用完整模型请求耗时计算，避免与界面展示的模型耗时口径不一致。
- **指挥家中途指导**：新增 `conductor_instruct`，向本父会话正在运行或排队的 worker 投递增量指令；在下一次模型调用边界送入，失败可重试，不中止 worker 或更换模型。
- **指挥家进度查询**：新增 `conductor_inspect`，按需查看所属 worker 的公开阶段、步骤、摘要及活动工具耗时；进度不是交付或验收证据，终态结果仍通过 `conductor_collect` 获取。
- **验证边界**：前端 lint、490 项库测试与构建，35 项相关 UI 回归，Python Conductor 33 项、协议 45 项、中途指令与真实 GA 循环安装夹具，以及 Go 专项与构建通过。Go 全量测试有 3 项 Windows 文件占用/重命名失败，隔离单跑均通过，不宣称全测通过；UI 全量测试亦有非本次范围失败，不宣称全量 UI 通过。真实 GA 循环覆盖使用假模型，不代表生产模型端到端验收。

## Unreleased

### v0.3.6 iteration (not released)
- **Conductor delivery review:** Separate execution completion from pending/verified/needs-work review; persist parent review basis, dispatch-owned tool evidence references, and unverified boundaries. Worker completion prose is not verification evidence.
- **Usage:** Expose parent, finalized-child, and recorded-total input/output tokens, with explicit missing-snapshot and incomplete-running-usage notices. Normalize cache protocols per call and preserve dispatch snapshot isolation.
- **Bounded dispatch:** Share a cumulative 48-dispatch limit between enforcement and API metadata; count worker reuse and all terminal outcomes. Regression covers accepting dispatch 48 and rejecting dispatch 49 without mutating the parent.
- **Documentation:** Explain Conductor versus automatic continuation modes and the limits of parent review and usage accounting.
- **Validation boundary:** Backend handler/persistence tests and fixture-based UI tests are not a live browser-to-worker end-to-end acceptance. No production deployment or release is implied.

### Bug Fixes
- **Chat:** Fixed cache hit rate calculation to use correct formulas for different API types
  - **Claude API (Modern)**: `cache_read / (output + cache_read)` — portion of generated content from cache
  - **Non-Claude API (Legacy)**: `cached / output` — cache-to-output ratio
  - **Mixed sessions**: weighted average by denominator size (previously only used Modern formula)
  - Automatically detects API type and applies appropriate formula

## v0.2.16 - 2026-08-24

### New Features
- **Models:** Added optional Chinese-friendly provider display names without changing configuration variable identities.
- **Models:** Added stable model instance identities, allowing the same model ID to be configured more than once under one provider and referenced independently in failover groups.
- **Chat:** Moved guided-message queues from browser-local storage to durable per-session server state.

### Improvements
- **Chat:** Large file-change summaries now collapse automatically and use a compact, stable layout that keeps assistant output visible.
- **Update:** Staged updates now require an explicit restart authorization step before replacing the running application.

### Reliability
- **Update:** Hardened replacement failure recovery so interrupted updates restore and restart the original service safely.
- **Compatibility:** Legacy failover references without an instance ID remain supported when they resolve to exactly one model instance; ambiguous references now fail explicitly instead of selecting the wrong instance.

### Validation
- Go tests and build pass across the full repository.
- Web lint, tests, and production build pass.

## v0.2.15 - 2026-08-21

### Bug Fixes
- **Chat:** Fixed cache hit rate calculation for legacy API models (OpenAI, etc.)
  - Legacy APIs report `cached_tokens` as a subset of `input_tokens`, but the old algorithm added both to the denominator, causing double-counting
  - Modern APIs (Claude) report `input_tokens`, `cache_creation_tokens`, and `cache_read_tokens` as disjoint buckets
  - The algorithm now detects API type per-turn and correctly handles mixed legacy/modern usage in the same session
  - Example: Legacy `input=100, cached=80` now correctly calculates as `80/100 = 80%` instead of incorrectly `80/180 = 44%`

- **Chat:** Exposed live tool timing in real-time during execution
  - Tool timing now updates progressively as tools run, not only after completion
  - Improves transparency for long-running operations

- **Chat:** Preserved assistant prose and tool call ordering in message display
  - Fixed rendering issue where tool calls could appear out of sequence relative to explanatory text

### Validation
- All 309 lib tests pass
- Web build successful
- No breaking changes

## v0.1.0-alpha2 - 2026-06-14

### Scope
- Follow-up alpha for `v0.1.0-alpha` focused on the Goal/Hive boundary and Windows background-process UX.
- Target branch: `main`; target tag: `v0.1.0-alpha2`.

### User-facing changes
- Removed the GA Admin built-in BBS collaboration page/API surface; Hive collaboration now follows the official GenericAgent external BBS/worker flow.
- Added Hive mode to Goal start so GA Admin can manage Goal/Hive lifecycle while delegating collaboration protocol details to GA official scripts.
- Goal state now reports Hive metadata such as readme URL, worker PID, BBS PID, and Hive working directory for operator visibility.
- Windows Goal/Hive background launches prefer `pythonw.exe` and keep no-window process flags to avoid popping terminal windows for users.

### Safety and validation
- Stop Goal now also cleans recorded Hive worker/BBS PIDs without broad process-tree termination.
- Release workflow explicitly accepts `v0.1.0-alpha2` in addition to prior approved release tags.
- Validation gates before publication: `go test ./...`, `go build ./...`, `npm.cmd test -- --run`, and `npm.cmd run build`.

## v0.1.0-alpha - 2026-06-12

### Scope
- Baseline: `v0.0.30-fix1`.
- Candidate commit anchor: `2202eb6 feat(admin): harden files and model configuration UX`.
- Current state: v0.1.0-alpha is approved for commit, push, tag creation, and GitHub release asset publication; live-service restart and existing-asset overwrite remain separate approvals.

### User-facing changes
- Files UI now protects configured roots, blocks traversal, supports download/open/delete guards, and keeps destructive operations behind explicit confirmation.
- Model configuration UX supports safe preview/write-back for local `mykey.py` generation without shipping private keys in source or release assets.
- Release/update documentation now separates three states: local RC evidence complete, user approval required, and post-publication verification.

### 中文用户摘要
- v0.1.0-alpha 聚焦 Admin 管理端的安全边界、配置体验和发布可审计性，属于正式 v0.1.0 前的 alpha 交付。
- 文件管理接口和界面交互收敛了危险路径与误操作风险；模型配置支持在管理端查看、调整和保存本地 GA 配置。
- 用户应按平台资产与 `.sha256` 校验文件完成升级验证；alpha 验证通过后再推进正式 v0.1.0。

### Approval boundary
- This alpha publication targets branch `main` and tag `v0.1.0-alpha`; formal `v0.1.0`, GitCode release, live-service restart, and existing-asset overwrite require separate approval.
- Packaging or workflow output must be checked for local/private files including `config.local.json`, `model_profiles.json`, `mykey.py`, `.env`, and `*.key`.
- Local review notes, temporary backups, and troubleshooting artifacts are excluded from the release commit by default unless the release owner explicitly chooses otherwise.

### Validation
- Release gates are rerun before tag publication: web tests, web build, Go tests/build, and diff hygiene.
- Alpha release gates are rerun before tag publication.
- Formal v0.1.0 readiness still depends on post-alpha verification and separate release-owner approval.
