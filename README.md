# TinyCode reimplementation

TinyCode is a minimal TypeScript coding-agent harness built on Pi. It provides a
CLI/TUI, workspace tools, permission policy, append-only sessions, context
management, local Skills, stdio MCP tools, and up to three read-only workers.

## Responsibility boundary

Pi owns model streaming, the Agent loop, tool dispatch, lifecycle events, and
cancellation. This project does not reimplement that loop. It supplies the
harness policy around Pi: model selection, tool registration, workspace path
guards, permission checks, Session and Context handling, extensions, and the
terminal interface. `bootstrapHarness()` is the single assembly point.

## Requirements and setup

- Node.js 22.19 or newer (CI covers Node 22.19 and Node 24)
- npm and the committed `package-lock.json`

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The default test suite is offline and needs no API key. It currently contains
16 test files and 101 tests, including a real Pi-loop repair of a copied broken
project and an interactive pseudo-terminal test.

## CLI

On the first interactive launch, TinyCode asks whether to use the offline mock
model or configure a `provider/model` reference. It then stores the selection
and default settings in `~/.tinycode/config.json`. Explicit `--mock`, `--model`,
environment, or project model configuration skips this wizard.

```bash
# Deterministic offline print mode
TINYCODE_MODEL=mock node dist/cli/index.js -p "describe this project"

# Interactive offline TUI
node dist/cli/index.js --mock

# Real provider/model selected from Pi's catalog
TINYCODE_PROVIDER=openai TINYCODE_MODEL=gpt-5 node dist/cli/index.js

# Headless write-capable run; hard-denied operations remain denied
TINYCODE_MODEL=mock node dist/cli/index.js --permission-mode auto -p "run the tests"
```

Supported options are `--help`, `--version`, `--model`, `--mock`,
`--list-models`, `-p`/`--prompt`, `--continue`, `--session`, and
`--permission-mode ask|auto`.

Interactive commands are `/help`, `/new`, `/clear`, `/resume`, `/sessions`,
`/model`, `/settings`, `/skills`, `/mcp`, `/agents`, `/compact`, `/status`, and `/exit`.
While busy, Ctrl+C, SIGINT, or Escape aborts the run. Ctrl+D exits. When idle,
press Ctrl+C twice within two seconds to exit.

## Configuration

Configuration precedence is CLI overrides, then environment variables, project
`.tinycode/config.json`, and finally user `~/.tinycode/config.json`. API keys
must be supplied through provider-specific environment variables; do not put
secrets in either configuration file.

```json
{
  "model": { "provider": "openai", "model": "gpt-5" },
  "maxOutputTokens": 4096,
  "permissionMode": "ask",
  "context": {
    "maxTokens": 32000,
    "compactThreshold": 0.8,
    "toolResultMaxChars": 12000
  },
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["./server.js"],
      "env": {}
    }
  }
}
```

Relevant environment variables include `TINYCODE_PROVIDER`, `TINYCODE_MODEL`,
`TINYCODE_PERMISSION_MODE`, `TINYCODE_MAX_OUTPUT_TOKENS`,
`TINYCODE_CONTEXT_MAX_TOKENS`, `TINYCODE_CONTEXT_COMPACT_THRESHOLD`, and
`TINYCODE_CONTEXT_TOOL_RESULT_MAX_CHARS`. Sessions default to
`~/.tinycode/sessions`; `TINYCODE_HOME` overrides that directory for the CLI.

Run `/settings` in the TUI to open the localized settings panel. It exposes
permission mode, maximum output tokens, context token budget, compaction
threshold, and tool-result character limit with Chinese labels and persists
changes to the user configuration. The Harness is rebuilt against the current
Session so changes apply immediately.

## Permissions and safety

Permissions are a policy gate, not an operating-system sandbox. Reads inside the
workspace are normally allowed; writes, edits, and risky commands require
approval in `ask` mode. Interactive mode offers Allow once, Always allow, and
Deny. Headless `ask` mode has no dialog and safely rejects requests requiring
approval. Explicit `auto` mode approves ordinary ASK decisions, but cannot
override hard-denied destructive commands.

The Bash tool executes on the host with the current user's privileges. Its cwd,
timeout, cancellation, and output are controlled, but it has no container,
filesystem namespace, network policy, or resource sandbox. Review commands and
run TinyCode only in a workspace you trust.

## Sessions, Context, Skills, MCP, and workers

- Sessions are append-only JSONL logs containing finalized messages. `--continue`
  only selects a Session for the same cwd; `--session` restores an explicit ID.
- Context compaction creates a temporary model view. Full Session history remains
  intact, and oversized tool output is preserved as a Session artifact.
- Skills are loaded from user and project `.tinycode/skills/<name>/SKILL.md`
  directories. Only metadata enters the initial prompt; bodies load on demand.
- MCP support is limited to local stdio servers. One failed server does not stop
  built-in tools or healthy servers.
- Workers have independent Pi transcripts, read-only tools, unique names, and a
  maximum concurrency of three.

## Known limitations

- Bash is not sandboxed; production isolation requires a container or VM layer.
- MCP HTTP/SSE, OAuth, resources, prompt templates, and multimodal results are
  not implemented; MCP results retain text only.
- Manual compaction changes only live memory and is not persisted as a Session
  compaction record.
- Skills cannot be downloaded or automatically executed.
- Workers are in-process and read-only; there is no remote worker transport,
  task DAG, or free-form worker messaging.
- Running-input steering/follow-up, Web/IDE clients, theme systems, advanced
  Markdown rendering, telemetry, cost tracking, and real-model stability
  benchmarks are outside the completed core scope.
