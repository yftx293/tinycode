# TinyCode 项目 Agent 执行规范与核心功能复现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Do not use sub-agents unless the user later explicitly authorizes parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零实现一个基于 Pi 的极简 Coding Agent Harness，复现 TinyCode 的核心运行链路、工具、安全、会话、上下文、Skill、MCP、只读子 Agent 和终端交互能力。

**Architecture:** Pi 负责模型流式调用、Agent Loop、工具调度、生命周期事件和中止；本项目负责 Harness 策略。所有扩展统一适配成 `AgentTool`，在 `bootstrapHarness()` 中完成依赖装配。`Agent.state.messages` 是运行期完整历史，Context 是每次调用模型前生成的临时视图，Session 是 append-only JSONL 持久化日志。

**Tech Stack:** Node.js `>=22.19`、TypeScript 5.x、ESM、`@earendil-works/pi-agent-core` `0.84.x`、`@earendil-works/pi-ai` `0.84.x`、`@earendil-works/pi-tui` `0.84.x`、MCP SDK、Zod、Vitest、ESLint。

**Spec:** 本文“架构与范围基线”“全局约束”和“阶段验收总表”；参考实现固定为 [`helsome/tinycode@6f70d7e`](https://github.com/helsome/tinycode/tree/6f70d7e8738642df7d8ff1414c37e985d1f4b6cd)。

## 给 Codex 的执行协议

1. 每次只执行用户明确指定的一个阶段。不要在当前阶段通过后自动进入下一阶段。
2. 开始阶段前，先阅读本文的全局约束、当前阶段、依赖阶段和验收条件。
3. 使用测试驱动：先写失败测试，确认失败原因正确，再写最小实现。
4. 只修改当前阶段“允许修改”的文件。需要越界时立即停止，说明原因并请求批准。
5. 不得删除、覆盖或还原用户已有改动；不得运行 `git reset --hard`、`git clean`、递归删除仓库等破坏性命令。
6. 一个阶段结束时必须提交：修改文件清单、实现摘要、测试命令与结果、遗留问题、`git diff --stat`。有失败项时不得声称完成。
7. 除非用户明确要求，不执行 push、创建 PR、部署、发布 npm 包或修改远端资源。

## 架构与范围基线

```text
CLI / TUI
    |
bootstrapHarness()                 <- 唯一依赖装配中心
    |
TinyCodeRuntime                    <- 将策略挂到 Pi Agent
    |-- beforeToolCall             <- PermissionManager
    |-- afterToolCall              <- ContextManager 截断
    |-- transformContext           <- ContextManager 压缩视图
    |-- subscribe(message_end)     <- SessionManager
    |
Pi Agent Core                      <- Agent Loop、流式事件、多工具执行、中止
    |
ToolRegistry
    |-- built-in tools
    |-- load_skill
    |-- MCP tools
    `-- sub-agent tools
```

必须保持以下边界：

- `src/agent/runtime.ts` 只负责将策略接入 Pi，不重新实现 Agent Loop。
- `src/bootstrap.ts` 只装配对象，不承载具体工具、权限或持久化逻辑。
- 所有文件工具必须先通过统一的 workspace path guard。
- 权限判断必须在工具执行之前完成，不能只依赖 System Prompt。
- 工具返回给模型的文本放在 `content`，供界面使用的结构化信息放在 `details`。
- Session 保存完整 finalized message；Context 压缩只决定本次发给模型的内容。
- 子 Agent 不共享主 Agent transcript，也不能获得写工具或创建子 Agent 的工具。

## 目标目录结构

```text
src/
  agent/prompt.ts
  agent/runtime.ts
  config/loader.ts
  config/schema.ts
  context/compact.ts
  context/manager.ts
  context/tool-results.ts
  model/registry.ts
  permissions/classifier.ts
  permissions/manager.ts
  permissions/rules.ts
  session/manager.ts
  session/storage.ts
  session/types.ts
  skills/loader.ts
  skills/registry.ts
  tools/bash.ts
  tools/diff.ts
  tools/edit.ts
  tools/find.ts
  tools/grep.ts
  tools/index.ts
  tools/ls.ts
  tools/paths.ts
  tools/read.ts
  tools/registry.ts
  tools/walk.ts
  tools/write.ts
  mcp/adapter.ts
  mcp/client.ts
  mcp/manager.ts
  agents/manager.ts
  agents/tools.ts
  agents/types.ts
  agents/worker.ts
  cli/args.ts
  cli/commands.ts
  cli/index.ts
  cli/sessions.ts
  tui/app.ts
  tui/permission-dialog.ts
  tui/slash.ts
  tui/status-bar.ts
  tui/tool-view.ts
  tui/transcript.ts
  tui/theme.ts
  bootstrap.ts
tests/
fixtures/
```

## 全局约束

- 包管理器统一使用 npm；提交 `package-lock.json`，不得混入 pnpm/yarn/bun 锁文件。
- TypeScript 开启 strict；源码使用 ESM，内部导入在编译目标下使用 `.js` 后缀。
- API Key 只能从环境变量读取，不写入配置文件、测试快照、日志或 Session。
- 所有测试默认离线执行；真实模型测试不进入默认测试集。
- 每个工具都必须支持 `AbortSignal` 能力边界；长进程必须有超时。
- 错误返回给模型时使用可操作的短消息，不泄露无关堆栈。
- 不直接整文件复制 TinyCode 源码。可以参照接口和行为，但实现必须按本计划逐阶段产生，并由测试证明。
- 第一版优先行为正确和边界清晰，不追求与 TinyCode 的 UI 像素级一致。

## 全项目暂时不做

- 不自研模型推理、Tokenizer、Function Calling 协议或 Agent Loop。
- 不做 Web UI、IDE 插件、桌面客户端、远程控制台和移动端。
- 不做多用户、账号、RBAC、计费、团队协作和云端同步。
- 不做容器沙箱、虚拟机沙箱或远程执行节点；文档必须明确 Bash 不是 OS 沙箱。
- 不做 RAG、向量数据库、长期语义记忆、知识图谱和联网搜索。
- 不做数据库 Session、分布式队列、跨进程子 Agent、Agent 间自由消息总线。
- 不做遥测平台、Langfuse、OpenTelemetry、成本看板和自动评测平台。
- 不做插件市场、Skill 安装器、MCP OAuth、HTTP/SSE MCP。
- 不提前修复自动压缩持久化、MCP 多模态结果等增强项；先完成主干等价实现。

---

## 阶段 0：工程骨架、配置与质量门禁

**阶段目标：** 建立可重复构建、测试和发布到本地 `dist/` 的空 Harness 工程。

**允许创建或修改：** 根目录配置文件、`src/config/**`、`src/model/registry.ts` 的接口骨架、`tests/config.test.ts`。

**必须完成：**

- [ ] 初始化 `package.json`，固定 Node 下限、ESM、CLI bin 和 `dev/build/typecheck/lint/test` 脚本。
- [ ] 配置 strict TypeScript、Vitest 和 ESLint。
- [ ] 定义 `.tinycode/config.json` 的 Zod Schema：模型、输出上限、权限模式、Context 参数、stdio MCP Server。
- [ ] 实现配置优先级：CLI 预留层 > 环境变量 > 项目配置文件。
- [ ] 检测配置中疑似 API Key 的字段并产生 warning，不能读取或回显其值。
- [ ] 建立最小 `src/cli/index.ts`，只支持 `--help`、`--version`，未知参数返回非零退出码。
- [ ] 写配置解析和 CLI smoke test。

**本阶段不能碰：** Agent Loop、编码工具、权限执行逻辑、Session、Context、Skill、MCP 连接、子 Agent、TUI。

**本阶段暂时不做：** 真实模型调用、交互式终端、配置热更新。

**验收命令：**

```bash
npm ci
npm run typecheck
npm run lint
npm test -- tests/config.test.ts tests/cli.test.ts
npm run build
node dist/cli/index.js --version
```

**通过标准：** 所有命令退出码为 0；无 API Key 时也能运行 help/version；源码中搜索不到硬编码密钥；`dist/cli/index.js` 可由 Node 直接执行。

**阶段停止条件：** 输出验收记录后停止，等待用户批准阶段 1。

---

## 阶段 1：模型注册表与最小 Pi Agent Runtime

**阶段目标：** 用 Pi 完成“用户消息 → 流式模型响应 → finalized assistant message”的最小闭环，并支持完全离线的脚本化 Mock 模型。

**允许创建或修改：** `src/model/registry.ts`、`src/agent/prompt.ts`、`src/agent/runtime.ts`、`src/bootstrap.ts`、`tests/runtime.test.ts`。

**接口约定：**

```ts
export interface ModelRef { provider?: string; model?: string }
export class ModelRegistry {
  enableMock(): Model<string>
  resolve(ref?: ModelRef): Promise<Model<unknown>>
  readonly streamFn: StreamFn
}

export class TinyCodeRuntime {
  readonly agent: Agent
  prompt(text: string): Promise<void>
  abort(): void
  waitForIdle(): Promise<void>
}
```

**必须完成：**

- [ ] 先写 Mock 模型回复和多轮消息累积测试，并确认测试失败。
- [ ] 封装 Pi provider catalog，模型选择遵循显式引用优先、已配置 provider 次之。
- [ ] 支持脚本化 Mock Provider，不需要网络和 API Key。
- [ ] 构建精简 System Prompt，只描述工作原则、项目根目录和工具使用原则。
- [ ] 创建 Pi `Agent`；当前阶段 hooks 使用直通实现，不加入任何业务策略。
- [ ] 暴露流式生命周期事件，测试 `message_start/update/end` 和 `agent_end`。
- [ ] 测试 `abort()` 与 busy 状态恢复。

**本阶段不能碰：** 自己编写 `while` Agent Loop；解析模型私有协议；工具执行；Session 写盘；TUI。

**本阶段暂时不做：** 自动重试、模型 fallback、成本统计、复杂 thinking 配置。

**验收命令：**

```bash
npm test -- tests/runtime.test.ts
npm run typecheck
npm run lint
```

**通过标准：** Mock 模型能够完成两轮对话；`Agent.state.messages` 顺序正确；没有重复实现 Pi Agent Loop；中止后 `isStreaming=false` 且下一次请求可正常运行。

**阶段停止条件：** 展示 Runtime 的公开接口和测试结果后停止。

---

## 阶段 2：统一工具注册表与七个内置编码工具

**阶段目标：** 建立统一 `AgentTool` 表，并让 Agent 能安全地读取、编辑项目和执行测试命令。

**允许创建或修改：** `src/tools/**`、`src/bootstrap.ts` 的工具注册部分、`tests/tools.test.ts`、`tests/workspace-boundary.test.ts`。

**接口约定：**

```ts
export class ToolRegistry {
  register(tool: AgentTool): void
  get(name: string): AgentTool | undefined
  has(name: string): boolean
  list(): AgentTool[]
  names(): string[]
}

export function resolveWorkspacePath(projectRoot: string, raw?: string): string
```

**必须完成：**

- [ ] 先写重复注册、稳定顺序和未知工具测试。
- [ ] 实现 `read`：行号、offset/limit、二进制检测、ENOENT/EISDIR 友好错误。
- [ ] 实现 `write`：自动创建父目录，返回新增/删除统计。
- [ ] 实现 `edit`：精确匹配；零匹配失败；多匹配默认失败；支持显式 `replaceAll`；返回 unified diff。
- [ ] 实现 `bash`：固定 project root、可选相对 cwd、默认 120 秒、最大 600 秒、AbortSignal、SIGTERM/SIGKILL 收尾、头尾输出限制。
- [ ] 实现 `grep/find/ls`，忽略 `.git`、`node_modules` 和二进制文件，并设置结果上限。
- [ ] 对所有文件路径执行 lexical + `realpath` 双重边界检查，覆盖现存目标、新文件最近祖先、目录符号链接和损坏符号链接。
- [ ] 将七个工具注册进 Runtime，使用 Mock 模型执行一次 read 调用。

**本阶段不能碰：** 权限审批、外部目录访问、Shell 沙箱、MCP、Skill、子 Agent、TUI。

**本阶段暂时不做：** Git 专用工具、Patch 工具、网络工具、Windows PowerShell 专用执行器、流式 stdout 更新。

**验收命令：**

```bash
npm test -- tests/tools.test.ts tests/workspace-boundary.test.ts
npm run typecheck
npm run lint
```

**通过标准：** 七个工具契约全部有测试；路径穿越和 symlink escape 被拒绝；Bash 超时和中止不会留下子进程；一次 `read → edit → bash` 手工脚本可执行。

**阶段停止条件：** 给出七个工具行为表和边界测试结果后停止。

---

## 阶段 3：权限分类、规则裁决与交互审批接口

**阶段目标：** 所有工具调用在执行前经过统一权限闸门，形成 `ALLOW / ASK / DENY` 三层语义。

**允许创建或修改：** `src/permissions/**`、`src/agent/runtime.ts` 的 `beforeToolCall`、`tests/permissions.test.ts`、`tests/permission-hardening.test.ts`。

**接口约定：**

```ts
export type PermissionAction = "allow" | "ask" | "deny"
export type PromptOutcome = "once" | "always" | "deny"
export type Decision =
  | { action: "allow"; reason: string }
  | { action: "deny"; reason: string }

export class PermissionManager {
  check(toolName: string, input: Record<string, unknown>): Promise<Decision>
  setPrompt(prompt: PromptFn): void
  setMode(mode: "ask" | "auto"): void
}
```

**必须完成：**

- [ ] 对 Shell 命令按组合片段分类为 safe/write/destructive，最高风险获胜。
- [ ] 项目内 read/grep/find/ls 自动允许；write/edit 必须 ASK；未知工具默认 ASK。
- [ ] `rm -rf /`、删除 HOME、`mkfs`、原始磁盘写入等规则必须硬 DENY，不能被 auto 覆盖。
- [ ] ask 模式无 Prompt 回调时安全拒绝；auto 只自动批准 ASK，不覆盖硬 DENY。
- [ ] 实现 once/always/deny，always 只在当前进程记忆命令族，不写磁盘。
- [ ] 将 `PermissionManager.check()` 接入 `beforeToolCall`；拒绝结果作为可读错误返回模型。
- [ ] 测试多工具调用中一个被拒绝时，其余合法工具仍按 Pi 的批次规则执行。

**本阶段不能碰：** 用 Prompt 代替权限规则；将硬 DENY 暴露给用户覆盖；把 allow pattern 永久写盘；宣称 Bash 已被沙箱隔离。

**本阶段暂时不做：** AST 级 Shell 解析、命令签名、企业 RBAC、工具能力元数据重构。

**验收命令：**

```bash
npm test -- tests/permissions.test.ts tests/permission-hardening.test.ts
npm run typecheck
npm run lint
```

**通过标准：** safe/write/destructive 表驱动测试通过；headless ask 拒绝写操作；auto 允许普通写操作但仍拒绝硬 DENY；被拒工具没有产生任何磁盘副作用。

**阶段停止条件：** 展示典型命令裁决矩阵后停止。

---

## 阶段 4：Session、项目记忆与上下文工程

**阶段目标：** 支持崩溃友好的完整会话恢复，同时控制单次模型上下文和超长工具结果。

**允许创建或修改：** `src/session/**`、`src/context/**`、`src/agent/prompt.ts`、`src/agent/runtime.ts` 对应 hooks、`src/bootstrap.ts` 对应装配、相关测试。

**必须完成：**

- [ ] 实现 UUIDv7 Session ID 和“一行 header + 多行 message”的 append-only JSONL。
- [ ] 每个 `message_end` 同步追加 finalized message；损坏的最后一行在恢复时跳过。
- [ ] `--continue` 的查询逻辑只匹配相同 cwd；显式 ID 严格恢复指定 Session。
- [ ] 读取项目根目录的 `TINY.md`，兼容追加 `AGENTS.md`、`CLAUDE.md`，注入 System Prompt。
- [ ] 工具结果超过阈值时保留头尾、标记丢弃字符数，并将完整文本写入 session artifacts。
- [ ] 使用确定性的 `JSON.stringify(message).length / 4` 估算 token。
- [ ] 超预算时从用户消息边界切分；旧消息生成摘要，最近消息及其工具结果保持原样。
- [ ] 自动压缩只返回模型输入视图，不修改完整 `Agent.state.messages` 和 JSONL。
- [ ] 手动 `compactNow()` 可以替换当前内存历史，但测试明确其不回写旧 Session。

**本阶段不能碰：** 数据库、覆盖式 Session 存储、压缩后删除原始 artifact、将 summary 混成 assistant 消息、后台定时压缩。

**本阶段暂时不做：** 可持久化压缩事件、增量摘要树、准确 Tokenizer、跨项目 Session 搜索、长期记忆。

**验收命令：**

```bash
npm test -- tests/session.test.ts tests/session-lifecycle.test.ts tests/context.test.ts
npm run typecheck
npm run lint
```

**通过标准：** 新建、追加、崩溃尾行、恢复、cwd 隔离全部通过；超长工具结果可在 transcript 中截断且 artifact 保留完整内容；自动压缩前后内存消息数量不变，发送给 Mock 模型的消息数量减少。

**阶段停止条件：** 明确报告 Session、Context、Memory 三者的数据流后停止。

---

## 阶段 5：Skill 渐进披露与 MCP stdio 扩展

**阶段目标：** 在不污染初始上下文的前提下加载 Skill，并将 stdio MCP 工具适配进统一工具表。

**允许创建或修改：** `src/skills/**`、`src/mcp/**`、`src/config/**` MCP 配置部分、`src/bootstrap.ts` 对应装配、fixtures 与相关测试。

**必须完成：**

- [ ] 扫描 `~/.tinycode/skills/<name>/SKILL.md` 和项目 `.tinycode/skills/<name>/SKILL.md`，项目同名 Skill 优先。
- [ ] 解析仅含简单 `key: value` 的 frontmatter；无 name 时使用目录名；空正文不注册。
- [ ] System Prompt 只加入 Skill name/description；正文只能通过 `load_skill(name)` 返回。
- [ ] Mock 测试证明未调用 Skill 时正文不在模型输入中，调用后正文作为 tool result 出现。
- [ ] 使用官方 MCP SDK 建立 stdio client；并行连接多个 Server；单点失败不阻断 Harness。
- [ ] MCP tool JSON Schema 适配为 `AgentTool.parameters`；同名冲突使用 `<server>_<tool>`。
- [ ] MCP 结果第一版仅保留文本，非文本块给出省略提示；连接和工具调用均有错误状态。
- [ ] shutdown 时关闭所有 MCP transport，测试无残留子进程。

**本阶段不能碰：** Skill 自动执行、递归 Skill 扫描、远程下载 Skill、MCP HTTP/SSE、OAuth、MCP 资源和 Prompt 模板。

**本阶段暂时不做：** Skill 版本管理、签名验证、多模态 MCP content、把 MCP `isError` 完整映射为 Pi error result、工具权限元数据。

**验收命令：**

```bash
npm test -- tests/skills.test.ts tests/mcp.test.ts
npm run typecheck
npm run lint
```

**通过标准：** Skill 渐进披露测试通过；真实 mock stdio MCP 进程能够 initialize/listTools/callTool/close；一个损坏 MCP Server 不影响内置工具运行。

**阶段停止条件：** 输出最终工具注册表及名称冲突示例后停止。

---

## 阶段 6：只读子 Agent 监督机制

**阶段目标：** 主 Agent 可以启动最多三个拥有独立上下文的只读 Worker，并通过结构化报告回收结果。

**允许创建或修改：** `src/agents/**`、`src/bootstrap.ts` 子 Agent 装配、`tests/subagents.test.ts`。

**接口约定：**

```ts
export interface WorkerReport {
  id: string
  name: string
  task: string
  status: "running" | "completed" | "aborted" | "error"
  report: string
  durationMs: number
}

export class SubAgentManager {
  spawn(name: string, task: string): WorkerReport
  wait(idOrName?: string): Promise<WorkerReport[]>
  close(idOrName: string): WorkerReport
  reports(): WorkerReport[]
  shutdown(): Promise<void>
}
```

**必须完成：**

- [ ] Worker 是独立 Pi `Agent`，拥有独立 transcript、AbortSignal 和固定研究型 System Prompt。
- [ ] Worker 只注册 `read/grep/find/ls`；不得获得 write/edit/bash/load_skill 或任何 sub-agent tools。
- [ ] Worker 禁用自动压缩，保留工具结果长度限制。
- [ ] 管理器限制最多三个 running Worker；名称唯一且只允许安全字符。
- [ ] 注册 `spawn_agent/list_agents/wait_agent/close_agent` 四个主 Agent 工具。
- [ ] `spawn_agent` 立即返回；`wait_agent` 等待一个或全部；最终 assistant text 转换成 `WorkerReport.report`。
- [ ] `shutdown()` 中止并等待所有未完成 Worker，避免进程退出后残留任务。

**本阶段不能碰：** Worker 写文件、Worker 执行 Bash、递归创建 Worker、共享主 Agent messages、共享可变任务状态、跨进程消息总线。

**本阶段暂时不做：** SendMessage、任务依赖图、动态模型选择、持久化 Worker、跨机器调度、Worker 自动重试。

**验收命令：**

```bash
npm test -- tests/subagents.test.ts
npm run typecheck
npm run lint
```

**通过标准：** spawn 非阻塞；wait 能取得报告；并发上限和唯一名称生效；close 能中止；Worker 尝试调用写工具时返回 tool-not-found，磁盘无变化。

**阶段停止条件：** 展示一次主 Agent 创建 Worker 并回收报告的消息链后停止。

---

## 阶段 7：CLI、TUI 与 Slash Command 集成

**阶段目标：** 提供可实际使用的交互式终端，并保持 UI 只消费事件、不承载 Agent 业务逻辑。

**允许创建或修改：** `src/cli/**`、`src/tui/**`、`src/bootstrap.ts` 最终入口装配、CLI/TUI 测试。

**必须完成：**

- [ ] CLI 支持 `--help/--version/--model/--mock/--list-models/-p/--continue/--session/--permission-mode`。
- [ ] `-p` 默认 ask 且没有审批 UI，因此 ASK 操作必须拒绝；只有显式 auto 才能无人值守写入。
- [ ] TUI 订阅 Agent 事件，展示流式文本、工具开始/结束、diff、退出码、错误和状态栏。
- [ ] 权限对话框实现 Allow once / Always allow / Deny，并连接 `PermissionManager.setPrompt()`。
- [ ] 支持 `/help /new /clear /resume /sessions /model /skills /mcp /agents /compact /status /exit`。
- [ ] `/new` 创建新 Session 并清空 live messages；`/clear` 只清空 live context，不创建 Session。
- [ ] Ctrl+C/SIGINT 在 busy 时中止；idle 时两秒内第二次退出；Ctrl+D 退出；Esc 中止。
- [ ] 状态栏展示模型、cwd、估算 Context、Session ID 和 running Worker 数。

**本阶段不能碰：** 在 TUI 中直接执行工具、直接写 Session、复制 Runtime 状态机、加入 Web Server、在 busy 时并发调用 `prompt()`。

**本阶段暂时不做：** Pi 的 steer/followUp 输入队列、主题系统、鼠标操作、复杂 Markdown 扩展、Windows Terminal 专属优化。

**验收命令：**

```bash
npm test -- tests/cli.test.ts tests/tui.test.ts
npm run typecheck
npm run lint
npm run build
TINYCODE_MODEL=mock node dist/cli/index.js -p "describe this project"
```

**通过标准：** CLI 参数与退出码符合约定；Mock print mode 有最终输出；TUI 事件映射测试通过；ask/auto 在交互和 headless 场景语义一致；退出时 MCP 和 Worker 均被关闭。

**阶段停止条件：** 给出 CLI 演示记录和 TUI 事件映射表后停止。

---

## 阶段 8：完整 Coding Agent 闭环与交付门禁

**阶段目标：** 使用脚本化 Mock 模型驱动真实 Pi Loop 和真实工具，完成可重复的代码修复 E2E。

**允许创建或修改：** `tests/harness.e2e.test.ts`、`tests/tui.pty.test.ts`、`fixtures/broken-project/**`、README 和必要的小范围缺陷修复；不得进行架构重写。

**必须完成：**

- [ ] 准备一个 `add()` 错误的 fixture，测试初始状态必须失败。
- [ ] 脚本化 Mock 模型依次产生 `bash → read → edit → bash → final`。
- [ ] 使用真实 ToolRegistry、PermissionManager、ContextManager 和 SessionManager 运行 E2E。
- [ ] 断言第一次测试 exit 1，edit 产生真实 diff，第二次测试 exit 0，磁盘文件被正确修复。
- [ ] 断言完整 user/assistant/toolResult 序列持久化，并可在新 Harness 中恢复继续对话。
- [ ] 增加硬 DENY、symlink escape、超时、MCP 故障隔离和 Worker 并发回归测试。
- [ ] 在 Node 22 和 Node 24 执行 CI；质量门禁依次为 typecheck、lint、test、build。
- [ ] README 明确 Pi 与本项目的责任边界、权限不是沙箱、配置方式和已知限制。

**本阶段不能碰：** 为让测试通过而跳过权限、mock 文件工具、缩减断言、吞掉错误、修改 fixture 的初始错误状态。

**本阶段暂时不做：** 发布 npm、部署服务、性能压测、真实模型稳定性基准、生产安全认证。

**验收命令：**

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
git status --short
```

**通过标准：** 全部命令通过；默认测试无网络和 API Key；E2E 确实修改临时 fixture 而不是仓库源文件；工作区无意外生成物；README 与实际 CLI、测试数量和限制一致。

**阶段停止条件：** 给出最终验收报告，不自动 push、发布或开始增强阶段。

---

## 阶段验收总表

| 阶段 | 可独立演示的成果 | 关键否决项 |
|---|---|---|
| 0 | 工程可构建，配置可解析 | 依赖/脚本不稳定，密钥进入配置 |
| 1 | Mock 模型多轮流式对话 | 自己重写 Agent Loop |
| 2 | 七工具完成读改测 | 路径可逃逸，进程无法中止 |
| 3 | 工具执行前权限裁决 | auto 可绕过硬 DENY |
| 4 | 会话恢复与临时 Context 压缩 | 压缩破坏完整 Session |
| 5 | Skill 按需加载、MCP 可调用 | 单个 MCP 故障拖垮启动 |
| 6 | 三个只读 Worker 可监督 | Worker 获得写权限或递归派生 |
| 7 | CLI/TUI 可用 | UI 绕开 Runtime 直接执行业务 |
| 8 | 真实工具驱动代码修复 E2E | 测试依赖网络或假执行工具 |

## 冻结的增强项

以下内容只有在阶段 8 完整通过、用户另行批准后才能进入新计划：

1. 为 `AgentTool` 增加 `risk/capability` 元数据，解决 `load_skill`、MCP、子 Agent 工具统一落入 ASK 的问题。
2. 增加持久化 compaction record 或 Session snapshot，使手动压缩在恢复后仍有效。
3. 完整传播 MCP `isError`，支持图片、资源链接和其他 content block。
4. 使用 Pi `steer/followUp` 支持运行中的用户追加指令。
5. 将 Bash 放入 Docker/VM 沙箱并增加资源配额、网络策略和文件挂载白名单。
6. 增加可观测性、Token 成本、工具耗时和 Agent 回归评测。
7. 增加跨进程/远程 Worker、任务 DAG 和异步消息通道。

## 每阶段交付模板

Codex 完成任一阶段时，必须使用下面的格式回复：

```markdown
阶段 N 已完成/未完成

实现：
- 逐条列出本阶段实际完成且已经验证的行为。

修改：
- 逐条列出真实文件路径、文件职责和本次变更。

验证：
- 逐条列出实际执行的完整命令、PASS/FAIL 和关键输出。

范围检查：
- 未修改禁止区域
- 未开始延期功能

遗留：
- 明确写“没有”，或者写明具体失败、影响和下一步。

停止：
- 等待用户审查，不进入阶段 N+1
```

## 完成定义

只有同时满足以下条件，才可以称项目核心复现完成：

- 阶段 0–8 共九个阶段逐一通过，且每阶段都有测试证据。
- 真实 Pi Agent Loop 能完成多轮工具调用，不存在伪造执行结果。
- 编码工具、权限、Session、Context、Skill、MCP、子 Agent 和 CLI/TUI 已通过集成测试。
- 默认测试完全离线、无密钥、可重复执行。
- 安全边界与已知限制被明确记录，没有把权限审批宣传成操作系统沙箱。
- `npm run typecheck && npm run lint && npm test && npm run build` 全部退出码为 0。
