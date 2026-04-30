# Claude Session Dashboard

Local Tamagotchi-style dashboard for every Claude Code session — watchers, AI summaries, live tail, Obsidian.

## Quickstart

1. `npm install`
2. Optional: copy `.env.example` to `.env.local` and set `OBSIDIAN_VAULT_PATH`.
3. `npm run dev`
4. Open `http://127.0.0.1:3000`

## Requirements

- Node 24+ (uses built-in `node:sqlite`)
- `claude` CLI on PATH (or set `CLAUDE_BIN`) for watcher runs and AI summaries
- Existing `~/.claude/` directory from prior Claude Code use

## Tests

- Unit/integration: `npm test` (40 tests across 16 files)
- E2E smoke: `npx playwright install chromium && npm run test:e2e`

## Security

Binds to `127.0.0.1` only. No auth — single-user local app.

## Architecture

Single Next.js process, App Router. SQLite (`node:sqlite` + FTS5) for index. chokidar watches `~/.claude/`. node-cron schedules watchers. `claude -p` spawned via stdin pipe (avoids ENAMETOOLONG with long jsonl context). SSE streams updates to browser. See `docs/superpowers/specs/2026-04-30-claude-session-dashboard-design.md`.

## v1 Features

- Pet zoo: every project as Tamagotchi card with HP, ASCII face, last activity
- Drill: project → child session pets → session detail (messages, summary, live tail)
- Watchers: cron + event triggers, per-pet free-text prompts + presets, manual run, webhook notifications
- AI summaries via headless `claude -p`
- Obsidian integration: writes daily notes, watcher prompts can use Obsidian MCP
- Activity feed (SSE-live)
- FTS search with snippet highlighting
- Settings: vault, webhook, health weights, concurrency caps
