# Claude Session Dashboard — Design Spec

**Date:** 2026-04-30
**Status:** Draft, pending implementation plan
**Owner:** eli08

## Purpose

Local web dashboard that lets the user monitor and manage every Claude Code session across all projects, like a "zoo of pets" — each session/project rendered as a Tamagotchi-style pet card with live status, AI-generated summary, health (HP), and a per-pet AI watcher that runs scheduled or event-triggered checks via headless `claude -p`. Foundation for future automation, analytics, and orchestration sub-projects.

## Non-goals (v1)

- Multi-user / networked access (single-user local only).
- Real embedding-based semantic search store (v1 uses FTS + Claude rerank).
- Editing or deleting user session data (read-only on `~/.claude/`).
- Browser-native or OS notifications (webhook + in-app feed only).
- Mobile-optimized UI.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14+ (App Router) |
| UI | React + Tailwind CSS |
| Persistence | SQLite via `better-sqlite3`, FTS5 |
| Filesystem watch | `chokidar` |
| Scheduler | `node-cron` |
| AI runtime | Headless `claude -p` (uses user's existing Claude Code subscription, no extra API key) |
| Process control | `child_process.spawn` + `tree-kill` for timeouts |
| Real-time UI | Server-Sent Events (SSE) |
| Notifications | Outbound HTTPS POST (Discord/Slack webhook) |
| Obsidian | Direct `fs` read/write to vault dir; watchers can also use Obsidian MCP via `claude -p` (zero dashboard code) |
| Testing | vitest (unit/integration), Playwright (smoke only) |

## Data sources (read-only inputs)

- `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` — full conversation logs.
- `~/.claude/sessions/<pid>.json` — live session heartbeat (`pid`, `sessionId`, `cwd`, `status`, `updatedAt`).
- `~/.claude/plans/*.md` — active plan files.
- `~/.claude/todos/*.json` — agent todo state.
- `~/.claude/tasks/*.json` — background task outputs.
- `~/.claude/agents/` — installed custom agents (read-only listing).
- `<vault>/` (optional, configured) — Obsidian vault for two-way notes.

## Architecture

Single Next.js process. UI, API, indexer, scheduler, watcher, and `claude -p` spawner all live in one Node runtime, coordinated through SQLite + an in-process EventEmitter bus.

```
┌──────────────────────── Next.js (port 3000) ─────────────────────────┐
│  Browser ↔ React UI (Tailwind)                                       │
│       │                                                               │
│       │  SSE /api/stream      (live updates)                         │
│       │  REST /api/...        (CRUD)                                  │
│       ▼                                                               │
│  App Router (api routes)                                             │
│       │                                                               │
│       ▼                                                               │
│  Singleton services (lib/)                                           │
│   • indexer    parse jsonls → SQLite                                 │
│   • watcher    chokidar on ~/.claude/                                │
│   • scheduler  node-cron + event triggers                            │
│   • runner     spawn `claude -p`, capture output                     │
│   • summarizer feed jsonl → runner → store                           │
│   • health     compute HP + face                                     │
│   • obsidian   vault writer/reader                                   │
│   • notify     webhook POSTs                                         │
│   • bus        EventEmitter pub/sub → SSE fanout                     │
│       │                                                               │
│       ▼                                                               │
│  SQLite — D:\dashboard\data\dashboard.db                              │
└──────────────────────────────────────────────────────────────────────┘
        │
        ├── reads ~/.claude/projects/**/*.jsonl
        ├── reads ~/.claude/sessions/*.json
        ├── reads ~/.claude/{plans,todos,tasks,agents}/
        └── spawns `claude -p "<prompt>"` in project cwd
```

Singletons stored on `globalThis` to survive Next dev hot-reload. Long jobs run via `child_process.spawn` so the event loop stays responsive.

Network binding: `127.0.0.1` only. No auth (single-user local).

## Data model (SQLite)

```sql
-- projects mirror ~/.claude/projects/
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,        -- hash of cwd
  cwd          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,        -- jsonl filename UUID
  project_id   TEXT NOT NULL REFERENCES projects(id),
  jsonl_path   TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  last_msg_at  INTEGER,
  msg_count    INTEGER DEFAULT 0,
  tokens_in    INTEGER DEFAULT 0,
  tokens_out   INTEGER DEFAULT 0,
  model        TEXT,
  ended_at     INTEGER,
  status       TEXT DEFAULT 'idle',     -- idle | active | error
  tail_offset  INTEGER DEFAULT 0        -- byte offset for incremental tail
);
CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_last_msg ON sessions(last_msg_at DESC);

-- full-text search over messages
CREATE VIRTUAL TABLE messages_fts USING fts5(
  session_id UNINDEXED,
  role,
  content,
  ts UNINDEXED,
  tokenize = 'porter unicode61'
);

-- live process heartbeats from ~/.claude/sessions/*.json
CREATE TABLE live_sessions (
  pid          INTEGER PRIMARY KEY,
  session_id   TEXT NOT NULL,
  cwd          TEXT NOT NULL,
  status       TEXT,                    -- busy | idle
  updated_at   INTEGER NOT NULL
);

-- AI summary + recommendation per session
CREATE TABLE summaries (
  session_id     TEXT PRIMARY KEY REFERENCES sessions(id),
  title          TEXT,
  summary        TEXT,
  recommendation TEXT,
  generated_at   INTEGER NOT NULL,
  generator      TEXT
);
CREATE VIRTUAL TABLE summaries_fts USING fts5(
  session_id UNINDEXED, title, summary, recommendation
);

-- watchers
CREATE TABLE watchers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scope          TEXT NOT NULL,         -- 'project' | 'session' | 'global'
  target_id      TEXT,                  -- project_id or session_id, NULL if global
  name           TEXT NOT NULL,
  prompt         TEXT NOT NULL,         -- user free-text + preset injected
  trigger_kind   TEXT NOT NULL,         -- 'cron' | 'event'
  trigger_value  TEXT NOT NULL,         -- cron string OR 'on:<event>'
  enabled        INTEGER DEFAULT 1,
  notify_webhook TEXT,                  -- optional override of global setting
  created_at     INTEGER NOT NULL
);

CREATE TABLE watcher_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  watcher_id  INTEGER NOT NULL REFERENCES watchers(id),
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  status      TEXT,                     -- 'running' | 'ok' | 'alert' | 'error'
  output      TEXT,                     -- captured stdout
  alert_msg   TEXT
);
CREATE INDEX idx_watcher_runs_watcher ON watcher_runs(watcher_id, started_at DESC);

-- in-app activity feed
CREATE TABLE feed (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL,            -- 'watcher_alert' | 'session_started' | 'summary_ready' | ...
  project_id  TEXT,
  session_id  TEXT,
  payload     TEXT NOT NULL             -- JSON
);
CREATE INDEX idx_feed_ts ON feed(ts DESC);

-- computed pet health snapshot
CREATE TABLE pet_health (
  scope         TEXT NOT NULL,          -- 'project' | 'session'
  target_id     TEXT NOT NULL,
  hp            INTEGER,                -- 0-100
  activity_pct  INTEGER,
  error_pct     INTEGER,
  watcher_pct   INTEGER,
  tokens_pct    INTEGER,
  face          TEXT,                   -- ASCII face per HP band
  ai_advice     TEXT,
  computed_at   INTEGER NOT NULL,
  PRIMARY KEY (scope, target_id)
);

-- linked obsidian notes cache
CREATE TABLE obsidian_notes (
  path        TEXT PRIMARY KEY,
  project_id  TEXT,
  session_id  TEXT,
  mtime       INTEGER NOT NULL,
  excerpt     TEXT
);

-- key/value settings
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seeded keys: 'claude_home', 'obsidian_vault_path', 'notify_webhook',
--              'health_weights' (JSON), 'concurrency_caps' (JSON)
```

## Components (lib/)

```
lib/
├─ db.ts              singleton better-sqlite3, migrations, prepared statements
├─ bus.ts             EventEmitter pub/sub
├─ paths.ts           resolve ~/.claude, vault, project cwds (cross-platform)
│
├─ indexer/
│   ├─ scan.ts        full scan ~/.claude/projects → upsert projects/sessions
│   ├─ jsonl.ts       parse jsonl → message rows + token tally + error detection
│   └─ live.ts        scan ~/.claude/sessions/*.json → live_sessions
│
├─ watcher/
│   ├─ fs.ts          chokidar on ~/.claude/{projects,sessions,plans,todos,tasks}
│   ├─ debounce.ts    coalesce file events
│   └─ events.ts      emit on bus: 'session:new' | 'session:msg' | 'live:change' | ...
│
├─ scheduler/
│   ├─ cron.ts        node-cron registry; register/unregister per watcher
│   ├─ events.ts      event-trigger router (subscribes bus → fires watcher)
│   └─ runner.ts      execute watcher: spawn claude -p, capture, write watcher_run + feed
│
├─ ai/
│   ├─ runClaude.ts   spawn `claude -p <prompt>` with cwd + timeout
│   ├─ summarize.ts   build prompt from jsonl tail → runClaude → write summaries
│   ├─ recommend.ts   ai_advice for low-HP pets
│   └─ semantic.ts    FTS top-K → claude rerank query
│
├─ health/
│   ├─ compute.ts     weighted formula
│   ├─ face.ts        HP → ASCII face
│   └─ recompute.ts   bus subscriber: re-runs on session/watcher events
│
├─ obsidian/
│   ├─ vault.ts       resolve and validate vault path
│   ├─ writer.ts      append daily notes (lockfile-protected)
│   └─ reader.ts      list/parse vault notes → obsidian_notes
│
├─ notify/
│   └─ webhook.ts     POST Discord/Slack URL on alerts (single retry)
│
└─ singletons.ts      bootstrap: indexer.scan + watchers.start + cron.reload
                      stash on globalThis for dev hot-reload survival
```

## API routes (app/api/)

```
GET    /api/projects                   — list with pet_health
GET    /api/projects/:id/sessions      — child sessions
GET    /api/sessions/:id               — metadata + summary
GET    /api/sessions/:id/messages      — paginated messages
GET    /api/sessions/:id/live          — SSE: live tail when active
POST   /api/sessions/:id/summarize     — force regen summary

GET    /api/watchers
POST   /api/watchers
PATCH  /api/watchers/:id
DELETE /api/watchers/:id
POST   /api/watchers/:id/run           — run now (manual trigger)
GET    /api/watchers/:id/runs          — history

GET    /api/feed                       — paginated events
GET    /api/stream                     — SSE: all bus events
GET    /api/search?q=&filters=         — FTS + structured + semantic

GET    /api/settings
PATCH  /api/settings
```

## UI routes (app/)

```
/                      pet zoo (project pets grid, Tamagotchi style)
/p/[projectId]         project detail + child session pets
/s/[sessionId]         session detail (messages, summary, watchers, live tail panel)
/watchers              watcher manager (list, create form)
/feed                  activity feed
/search                search page
/settings              vault path, webhook, claude_home, health weights, caps
```

## Visual style

Tamagotchi pet cards (validated via brainstorming visual companion):

- Yellow/cream card background, retro 3px black border, hard shadow.
- Inner "screen" panel renders ASCII face per HP band:
  - HP ≥ 80 → `(◕‿◕)`
  - HP ≥ 50 → `(•ᴗ•)`
  - HP ≥ 25 → `(-_-)`
  - HP < 25  → `(╥﹏╥)`
- Screen background tints with HP (green/cream/grey/red).
- HP bar (4px) below screen, color matches band.
- Stats row: `HP {n}` left, `{relative time}` right.
- Pulse animation on screen border when session is `active` (live-tail subscribed).
- Click pet → drill: project pet → grid of child session pets → session detail.

## Watcher engine

### Watcher record

```ts
type Watcher = {
  id: number
  scope: 'project' | 'session' | 'global'
  target_id: string | null
  name: string
  prompt: string
  trigger_kind: 'cron' | 'event'
  trigger_value: string
  enabled: 0 | 1
  notify_webhook: string | null
}
```

### Lifecycle

```
[user creates watcher]
      ↓
scheduler.register(watcher)
      ├─ cron:   cron.schedule(value, () => runner.run(watcher))
      └─ event:  bus.on(value, ctx => runner.run(watcher, ctx))
      ↓
[fire — cron tick or event match]
      ↓
runner.run(watcher, ctx?)
      ├─ INSERT watcher_runs (status='running')
      ├─ build prompt:
      │     header  = "You are a watcher for {scope} {name}. User instruction: {prompt}"
      │     context = jsonl tail (last N msgs) + file changes + plan/todos snapshot
      │     footer  = "Reply JSON: {status:'ok'|'alert', message, recommendation}"
      ├─ spawn `claude -p <prompt>` cwd=<project_cwd> timeout=10min
      ├─ stream stdout → watcher_runs.output (live update via bus)
      ├─ on exit:
      │     parse JSON tail → status, message
      │     UPDATE watcher_runs SET status, ended_at, alert_msg
      │     INSERT feed (kind='watcher_done' | 'watcher_alert')
      │     if status='alert' AND notify_webhook: POST webhook
      │     bus.emit('watcher:done', {...})
      └─ on error/timeout: status='error', tree-kill, log, emit
```

### Triggers

| `trigger_value` | Source bus event |
|---|---|
| `0 */30 * * *` (any cron) | `node-cron` schedule |
| `on:session_new` | `session:new` (new jsonl detected) |
| `on:session_msg` | `session:msg` (debounced jsonl append) |
| `on:error` | `session:error` (error tool result during indexing) |
| `on:idle_30m` | timer per session, fires after 30m of no activity |
| `on:plan_change` | `plan:change` (file in `~/.claude/plans/` modified) |
| `on:todo_change` | `todo:change` |

### Concurrency

- Per-watcher: skip if previous run still active (configurable: queue vs skip; default skip).
- Global: cap of 3 concurrent `claude -p` watcher processes + 2 concurrent summary processes (defaults; tunable in settings).
- Queue depth published on bus → UI shows "N watchers queued".

### Manual run

`POST /api/watchers/:id/run` invokes `runner.run()` directly, bypassing schedule. UI surfaces a button on each pet.

## Live-tail engine

- `indexer/live.ts` polls `~/.claude/sessions/*.json` every 2s. Upserts `live_sessions`. Row missing or `updatedAt` >60s old → delete + emit `live:gone`.
- For each live row, locate `<encoded-cwd>/<sessionId>.jsonl`. Tail using `fs.createReadStream` from `sessions.tail_offset`. On `data`, split lines, parse, emit `session:msg`. Save offset.
- chokidar on the projects dir signals when jsonl size grows; reader re-opens stream from saved offset.
- `/api/stream` SSE fans out events to browser. Pet cards subscribe per `sessionId` / `projectId`. On `session:msg` → pulse animation, push into in-memory tail buffer (last 50 messages). Click pet → side panel renders buffer.
- `/api/sessions/:id/live` provides per-session SSE (filtered) for the side panel.
- `session:msg` also debounces a `health.recompute(sessionId)` call (5s) → updates `pet_health.activity_pct` + emits `health:change`.

## AI summary engine

### Triggers

- New session detected after 5+ messages exchanged → enqueue.
- Session ends (live row gone for >60s) → enqueue final summary.
- User clicks "regenerate" on pet detail → enqueue priority.

### Prompt template

```
You are summarizing a Claude Code session for a dashboard.
Project: {name} ({cwd})
Session: {id} ({msg_count} turns, started {date})

Recent messages (jsonl excerpt):
<truncated to last ~8k tokens of meaningful content>

Reply ONLY with JSON:
{
  "title": "<8 words max>",
  "summary": "<2-3 sentences, what was done>",
  "recommendation": "<1 sentence: next step OR 'none'>",
  "why_low_hp": "<string OR null — only if HP<50>",
  "advice": "<string OR null — actionable 1-liner>"
}
```

Spawn `claude -p` (with `--output-format json` if available, else parse stdout JSON tail). Write to `summaries`. Same call returns `ai_advice` for low-HP pets.

## Health computation

```ts
activity_pct = clamp01(1 - (now - last_msg_at) / 7days) * 100
error_pct    = clamp01(1 - error_count / max(msg_count, 1)) * 100
watcher_pct  = latest_watcher_run.status: ok=100, alert=20, error=50, none=70
tokens_pct   = 100 - clamp01(tokens / quota_threshold) * 100
hp           = round(w.a*activity + w.e*error + w.w*watcher + w.t*tokens)
face         = hp >= 80 ? '(◕‿◕)'
             : hp >= 50 ? '(•ᴗ•)'
             : hp >= 25 ? '(-_-)'
             :            '(╥﹏╥)'
```

Default weights (settable): `{ activity: 0.4, errors: 0.3, watcher: 0.2, tokens: 0.1 }`.

Project HP = max of child session HPs (default; switchable to weighted average).

`tokens_pct` uses a configurable `quota_threshold` (default: 5M tokens).

## Obsidian integration

Three modes, all enabled together when `obsidian_vault_path` is set:

### 1. Direct vault write (dashboard → vault)

- Daily note path: `{vault}/Claude Sessions/{YYYY-MM-DD}.md`.
- Append on: summary ready, watcher alert, session ended.
- Per-event format:

```md
## {time} · {project} · {session_id_short}
**Title:** {title}
**Summary:** {summary}
**Recommendation:** {recommendation}

> Watcher alert: {message}
```

- File-locked via `proper-lockfile` to coexist with Obsidian app holding the file open.

### 2. Watchers via Obsidian MCP (zero dashboard work)

- When user has Obsidian MCP configured for `claude`, watcher prompts can directly say `"append to my Obsidian notes ..."` and `claude -p` will use the MCP tools. No dashboard wiring needed.

### 3. Vault → dashboard (read)

- `obsidian/reader.ts` watches `{vault}/Claude Sessions/` plus any note with front-matter `project: <name>`. Cache excerpt to `obsidian_notes`. Pet detail page renders linked notes section.

## Notifications

- **In-dashboard feed** (always-on): `feed` table → `/feed` page → SSE pushes new entries.
- **Webhook (Discord/Slack)** (configured): on `watcher_alert`, POST JSON `{watcher, message, recommendation, project, session, ts}`. Single retry on failure; then disable webhook with feed warning until user re-enables in settings.

## Error handling

| Surface | Strategy |
|---|---|
| `claude` CLI missing | Boot check; show banner; disable run buttons. |
| jsonl malformed line | Skip line, log warn, continue. |
| SQLite locked | Single-writer pattern; readers OK (better-sqlite3 sync). |
| chokidar fails on Windows network/OneDrive | Document unsupported; allow polling fallback flag. |
| SSE client disconnect | Cleanup listeners on `req.signal.abort`; cap listeners. |
| Watcher timeout (>10min) | `tree-kill` PID; `status='error'`; `alert_msg='timeout'`. |
| Webhook failure | Retry once; then disable webhook with feed warning. |
| Vault path invalid | Settings UI validates dir exists + writable; reject on save. |
| Project cwd no longer exists | Skip run; disable watcher after 3 consecutive misses. |

## Security

- Bind to `127.0.0.1` only. Hard-coded for v1.
- No auth — single-user local app, documented prominently.
- Path-traversal guard: every read validated against `claude_home` allowlist.
- Watcher prompts execute `claude -p` in user's project cwd — already user-owned, no extra sandboxing.
- Webhook URL stored plain in SQLite (local file, user controls FS).
- `.env` for vault path + secrets, gitignored.

## Testing

- **Unit (vitest)**: `jsonl.parse`, `health.compute`, `face.fromHp`, prompt builders, cron-value parser.
- **Integration**: in-memory SQLite + fixture jsonls in temp dir → run indexer → assert tables. Mock `claude -p` with a fake binary on PATH (echoes a canned JSON envelope).
- **E2E (Playwright, smoke only)**: open `/`, wait for pet grid, click pet → see detail. No live-tail E2E (timing flaky).
- **Manual checklist**: live-tail with real Claude session, watcher cron firing, webhook POST, Obsidian append.

## v1 success criteria

1. `npm run dev` opens `http://localhost:3000` and the pet zoo loads with all real `~/.claude/projects/*` entries.
2. Opening a Claude Code session in another terminal causes its pet to pulse and the side panel to stream new messages within ~2s of each new turn.
3. Creating a watcher "every 30m, summarize new commits" results in a successful cron-triggered run with output in the feed.
4. Manually triggering a watcher returns output in <30s for a small project.
5. A watcher producing `status='alert'` triggers a webhook POST to the configured Discord/Slack URL.
6. AI summary + recommendation render on the pet detail page within 30s of a session reaching 5+ messages.
7. Obsidian vault gets daily-note appends when configured.

## Explicit deferrals (v2+)

- Multi-user / network access (auth, ACLs).
- Real embedding-based semantic search (`sqlite-vss` or external store).
- Editing or deleting jsonls / sessions from the dashboard.
- OS / browser-native notifications.
- Mobile-optimized UI.
- Cross-machine session aggregation (sync from multiple workstations).
- Cost / quota analytics dashboard.
- Headless agent dispatcher (run `/<custom-agent>` from dashboard).

## Decomposition map (future sub-projects)

| Order | Sub-project | Builds on |
|---|---|---|
| **v1** | Browser + summaries + watchers + live-tail (this spec) | — |
| v2a | Real semantic search (embeddings) | v1 search APIs |
| v2b | Headless agent dispatcher (run `/agent` from UI) | v1 watcher engine |
| v2c | Analytics (token spend, project velocity, productivity) | v1 indexer |
| v3 | Multi-machine sync + auth | v1 + v2 |
