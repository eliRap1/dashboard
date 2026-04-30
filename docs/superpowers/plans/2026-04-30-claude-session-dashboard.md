# Claude Session Dashboard Implementation Plan

> **Pivot Note (2026-04-30):** v1 uses Node 24's built-in `node:sqlite` (FTS5 supported, no native build) instead of `better-sqlite3`. API differences absorbed in `lib/db.ts`: `db.pragma(...)` → `db.exec("PRAGMA ...")`, `db.transaction(fn)` → manual `BEGIN`/`COMMIT` helper. Row objects from `prepare(...).get()/.all()` have a null prototype — copy with `{...row}` if downstream code needs a plain object.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local Next.js dashboard rendering every Claude Code session as a Tamagotchi-style pet card with live-tail, AI summaries via headless `claude -p`, scheduled/event-triggered watchers, webhook notifications, and Obsidian vault integration.

**Architecture:** Single Next.js (App Router) process. UI, REST API, SQLite (better-sqlite3 + FTS5) indexer, chokidar filesystem watcher, node-cron scheduler, and Node `spawn`-based `claude -p` runner all run inside one Node runtime, coordinated by an in-process EventEmitter bus. SSE pushes live updates to React clients. Singletons stored on `globalThis` to survive Next dev hot-reload.

**Tech Stack:** Next.js 14+, React, Tailwind CSS, TypeScript, better-sqlite3, FTS5, chokidar, node-cron, tree-kill, proper-lockfile, vitest, Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-04-30-claude-session-dashboard-design.md`

---

## File Structure

```
package.json, tsconfig.json, next.config.js, tailwind.config.ts, postcss.config.js
.env.example, .eslintrc.json, vitest.config.ts, playwright.config.ts

app/
├─ layout.tsx, globals.css, page.tsx (pet zoo)
├─ p/[projectId]/page.tsx
├─ s/[sessionId]/page.tsx
├─ watchers/page.tsx, feed/page.tsx, search/page.tsx, settings/page.tsx
└─ api/
   ├─ projects/route.ts
   ├─ projects/[id]/sessions/route.ts
   ├─ sessions/[id]/{route,messages,live,summarize}.ts
   ├─ watchers/{route,[id]/{route,run,runs}}.ts
   ├─ feed/route.ts, stream/route.ts, search/route.ts, settings/route.ts

components/
├─ PetCard.tsx, PetGrid.tsx, LiveTailPanel.tsx, MessageList.tsx
├─ WatcherForm.tsx, WatcherList.tsx, FeedList.tsx, SearchBar.tsx, SettingsForm.tsx
└─ useEventStream.ts (hook)

lib/
├─ db.ts, bus.ts, paths.ts, singletons.ts
├─ migrations/001_init.sql
├─ indexer/{scan,jsonl,live}.ts
├─ watcher/{fs,debounce,events}.ts
├─ scheduler/{cron,events,runner}.ts
├─ ai/{runClaude,summarize,recommend,semantic}.ts
├─ health/{compute,face,recompute}.ts
├─ obsidian/{vault,writer,reader}.ts
└─ notify/webhook.ts

tests/
├─ fixtures/{session-simple,session-with-error}.jsonl
├─ unit/{jsonl,health,face,paths,cron-parser}.test.ts
├─ integration/{indexer,runner,obsidian,watcher-engine}.test.ts
└─ e2e/smoke.spec.ts

scripts/fake-claude.cjs              # mocks `claude` binary for tests
data/                                # gitignored, db file lives here
```

---

## Task 1: Project bootstrap (Next.js + TypeScript)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `.eslintrc.json`, `.env.example`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`

- [ ] **Step 1.1: Init package.json**

```json
{
  "name": "claude-session-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000 -H 127.0.0.1",
    "build": "next build",
    "start": "next start -p 3000 -H 127.0.0.1",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "better-sqlite3": "^11.3.0",
    "chokidar": "^3.6.0",
    "node-cron": "^3.0.3",
    "tree-kill": "^1.2.2",
    "proper-lockfile": "^4.1.2"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node-cron": "^3.0.11",
    "@types/proper-lockfile": "^4.1.4",
    "typescript": "^5.5.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "^14.2.0",
    "vitest": "^2.0.0",
    "@playwright/test": "^1.46.0"
  }
}
```

- [ ] **Step 1.2: Install dependencies**

Run: `npm install`
Expected: lockfile created. better-sqlite3 builds native binary.

- [ ] **Step 1.3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "tests/e2e"]
}
```

- [ ] **Step 1.4: next.config.js**

```js
/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ["better-sqlite3", "chokidar", "node-cron"] }
};
```

- [ ] **Step 1.5: Minimal layout/globals/home**

`app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`app/layout.tsx`:
```tsx
import "./globals.css";
export const metadata = { title: "Claude Session Dashboard" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="bg-amber-50 text-stone-900">{children}</body></html>;
}
```

`app/page.tsx`:
```tsx
export default function Home() {
  return <main className="p-8"><h1 className="text-2xl font-bold">Claude Session Dashboard</h1></main>;
}
```

- [ ] **Step 1.6: Verify dev server boots**

Run: `npm run dev`. Expected: serves at http://127.0.0.1:3000 with placeholder text. Stop with Ctrl+C.

- [ ] **Step 1.7: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.js app/ .eslintrc.json
git commit -m "Bootstrap Next.js + TypeScript shell"
```

---

## Task 2: Tailwind + Tamagotchi base styles

**Files:**
- Create: `tailwind.config.ts`, `postcss.config.js`
- Modify: `app/globals.css`

- [ ] **Step 2.1: tailwind.config.ts**

```ts
import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["'JetBrains Mono'", "ui-monospace", "monospace"] },
      animation: { "tama-pulse": "tamaPulse 1.4s ease-in-out infinite" },
      keyframes: {
        tamaPulse: {
          "0%,100%": { boxShadow: "4px 4px 0 #1f2937" },
          "50%":     { boxShadow: "4px 4px 0 #16a34a" }
        }
      }
    }
  },
  plugins: []
};
export default config;
```

- [ ] **Step 2.2: postcss.config.js**

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 2.3: Tamagotchi base classes — append to `app/globals.css`**

```css
@layer components {
  .tama-card {
    @apply bg-amber-100 border-[3px] border-stone-900 rounded-2xl p-3
           shadow-[4px_4px_0_#1f2937] flex flex-col gap-2 min-h-[170px];
  }
  .tama-card-active { @apply animate-tama-pulse; }
  .tama-screen {
    @apply bg-green-300 border-2 border-stone-900 rounded-md p-2 min-h-[88px]
           flex flex-col items-center justify-center;
  }
  .tama-face   { @apply text-3xl leading-none font-mono; }
  .tama-mood   { @apply text-[10px] mt-1 font-mono; }
  .tama-name   { @apply mt-2 font-bold text-xs uppercase tracking-wider; }
  .tama-bar    { @apply h-1 bg-white border border-stone-900 rounded-sm overflow-hidden; }
  .tama-bar-fill { @apply h-full bg-green-500 transition-all; }
  .tama-stats  { @apply flex justify-between text-[9px] mt-1 font-mono; }
}
```

- [ ] **Step 2.4: Verify**

Run: `npm run dev`. Hard reload `/`. Expect Tailwind utilities active (no console errors).

- [ ] **Step 2.5: Commit**

```bash
git add tailwind.config.ts postcss.config.js app/globals.css
git commit -m "Add Tailwind config + Tamagotchi card classes"
```

---

## Task 3: Vitest setup + sanity test

**Files:**
- Create: `vitest.config.ts`, `tests/unit/sanity.test.ts`

- [ ] **Step 3.1: vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules"],
    testTimeout: 30000
  }
});
```

- [ ] **Step 3.2: Sanity test**

`tests/unit/sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
describe("sanity", () => {
  it("math still works", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 3.3: Run**

Run: `npm test`. Expected: 1 passed.

- [ ] **Step 3.4: Commit**

```bash
git add vitest.config.ts tests/unit/sanity.test.ts
git commit -m "Add vitest config + sanity test"
```


---

## Task 4: `lib/paths.ts` — cross-platform path helpers

**Files:**
- Create: `lib/paths.ts`, `tests/unit/paths.test.ts`

- [ ] **Step 4.1: Failing test**

`tests/unit/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { encodeCwdToProjectsDir, projectsDir, sessionsDir, claudeHome } from "@/lib/paths";

describe("paths", () => {
  it("claudeHome resolves under user home", () => {
    expect(claudeHome()).toMatch(/[\/]\.claude$/);
  });
  it("projectsDir under claudeHome", () => {
    expect(projectsDir()).toMatch(/[\/]\.claude[\/]projects$/);
  });
  it("sessionsDir under claudeHome", () => {
    expect(sessionsDir()).toMatch(/[\/]\.claude[\/]sessions$/);
  });
  it("encodes Windows cwd D:\dashboard to D--dashboard", () => {
    expect(encodeCwdToProjectsDir("D:\dashboard")).toBe("D--dashboard");
  });
  it("encodes posix cwd /Users/eli/foo bar to dash form", () => {
    expect(encodeCwdToProjectsDir("/Users/eli/foo bar")).toBe("-Users-eli-foo-bar");
  });
});
```

- [ ] **Step 4.2: Run — expect fail**

Run: `npm test -- tests/unit/paths.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement**

`lib/paths.ts`:

```ts
import os from "node:os";
import path from "node:path";

export function claudeHome(): string {
  const override = process.env.CLAUDE_HOME?.trim();
  return override && override.length > 0 ? override : path.join(os.homedir(), ".claude");
}
export function projectsDir(): string { return path.join(claudeHome(), "projects"); }
export function sessionsDir(): string { return path.join(claudeHome(), "sessions"); }
export function plansDir():    string { return path.join(claudeHome(), "plans"); }
export function todosDir():    string { return path.join(claudeHome(), "todos"); }
export function tasksDir():    string { return path.join(claudeHome(), "tasks"); }
export function agentsDir():   string { return path.join(claudeHome(), "agents"); }

export function encodeCwdToProjectsDir(cwd: string): string {
  return cwd
    .replace(/^([A-Za-z]):/, "$1")
    .replace(/[\/]/g, "-")
    .replace(/\s+/g, "-");
}

export function assertUnderClaudeHome(p: string): void {
  const root = claudeHome();
  const resolved = path.resolve(p);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error(`path is outside claude home`);
  }
}
```

- [ ] **Step 4.4: Run — expect pass**

Run: `npm test -- tests/unit/paths.test.ts`. Expected: 5 passed.

- [ ] **Step 4.5: Commit**

```bash
git add lib/paths.ts tests/unit/paths.test.ts
git commit -m "Add paths lib + tests"
```

---

## Task 5: `lib/db.ts` + initial migration

**Files:**
- Create: `lib/db.ts`, `lib/migrations/001_init.sql`, `data/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 5.1: Append data dir rules to `.gitignore`**

```
data/*.db
data/*.db-*
!data/.gitkeep
```

- [ ] **Step 5.2: Migration SQL**

Create `lib/migrations/001_init.sql` with the full schema from the spec section "Data model (SQLite)" (every table verbatim — `projects`, `sessions`, `messages_fts`, `live_sessions`, `summaries`, `summaries_fts`, `watchers`, `watcher_runs`, `feed`, `pet_health`, `obsidian_notes`, `settings`). Plus add at top of the file:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);
```

And seed defaults at the bottom:

```sql
INSERT OR IGNORE INTO settings(key,value) VALUES
  ('health_weights', '{"activity":0.4,"errors":0.3,"watcher":0.2,"tokens":0.1}'),
  ('concurrency_caps', '{"watchers":3,"summaries":2}'),
  ('quota_threshold', '5000000'),
  ('project_hp_strategy', 'max');
```

Add `IF NOT EXISTS` to every `CREATE TABLE` / `CREATE INDEX` / `CREATE VIRTUAL TABLE` so the migration is idempotent.


- [ ] **Step 5.3: db.ts**

`lib/db.ts`:

```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dataDir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.DASHBOARD_DB ?? path.join(dataDir, "dashboard.db");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  runMigrations(_db);
  return _db;
}

function runMigrations(db: Database.Database) {
  const sqlPath = path.resolve(process.cwd(), "lib/migrations/001_init.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");
  db.exec(sql);
}

export function _resetDbForTests() { _db?.close(); _db = null; }
```

`data/.gitkeep`: empty file.

- [ ] **Step 5.4: Failing test**

`tests/integration/db.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getDb, _resetDbForTests } from "@/lib/db";

describe("db", () => {
  afterEach(() => { _resetDbForTests(); });
  it("creates db file and migrates schema", () => {
    const tmp = path.join(process.cwd(), "data/test-db-1.db");
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    process.env.DASHBOARD_DB = tmp;
    const db = getDb();
    const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(row.version).toBe(1);
    expect(fs.existsSync(tmp)).toBe(true);
    db.close();
    fs.unlinkSync(tmp);
    delete process.env.DASHBOARD_DB;
  });
});
```

- [ ] **Step 5.5: Run + Commit**

Run: `npm test -- tests/integration/db.test.ts`. Expected: PASS.

```bash
git add lib/db.ts lib/migrations/ tests/integration/db.test.ts data/.gitkeep .gitignore
git commit -m "Add SQLite db singleton + initial migration"
```

---

## Task 6: `lib/bus.ts` — pub/sub singleton

**Files:**
- Create: `lib/bus.ts`, `tests/unit/bus.test.ts`

- [ ] **Step 6.1: Failing test**

`tests/unit/bus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bus } from "@/lib/bus";

describe("bus", () => {
  it("emits and receives", () => {
    const got: any[] = [];
    bus.on("test:e", d => got.push(d));
    bus.emit("test:e", { a: 1 });
    expect(got).toEqual([{ a: 1 }]);
  });
  it("survives across imports (singleton)", async () => {
    const m1 = await import("@/lib/bus");
    const m2 = await import("@/lib/bus");
    expect(m1.bus).toBe(m2.bus);
  });
});
```

- [ ] **Step 6.2: Implement**

`lib/bus.ts`:

```ts
import { EventEmitter } from "node:events";

declare global { var __dashboardBus: EventEmitter | undefined; }

function makeBus() {
  const e = new EventEmitter();
  e.setMaxListeners(200);
  return e;
}

export const bus: EventEmitter = globalThis.__dashboardBus ?? (globalThis.__dashboardBus = makeBus());

export type BusEvents =
  | "session:new" | "session:msg" | "session:error" | "session:end"
  | "live:change" | "live:gone"
  | "watcher:run-started" | "watcher:done" | "watcher:alert"
  | "feed:new" | "health:change"
  | "plan:change" | "todo:change" | "task:change";
```

- [ ] **Step 6.3: Run + Commit**

Run: `npm test -- tests/unit/bus.test.ts`. Expected: PASS.

```bash
git add lib/bus.ts tests/unit/bus.test.ts
git commit -m "Add EventEmitter bus singleton"
```

---

## Task 7: `lib/indexer/jsonl.ts` — line parser + token tally

**Files:**
- Create: `lib/indexer/jsonl.ts`, `tests/fixtures/session-simple.jsonl`, `tests/fixtures/session-with-error.jsonl`, `tests/unit/jsonl.test.ts`

- [ ] **Step 7.1: Fixture: simple session**

`tests/fixtures/session-simple.jsonl` (one JSON object per line):

```jsonl
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]},"timestamp":"2026-04-30T12:00:00.000Z"}
{"type":"assistant","message":{"role":"assistant","model":"claude-opus-4-7","content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":12,"output_tokens":3}},"timestamp":"2026-04-30T12:00:01.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"thanks"}]},"timestamp":"2026-04-30T12:00:05.000Z"}
```

- [ ] **Step 7.2: Fixture: session with tool error**

`tests/fixtures/session-with-error.jsonl`:

```jsonl
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"run cmd"}]},"timestamp":"2026-04-30T12:01:00.000Z"}
{"type":"assistant","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"false"}}],"usage":{"input_tokens":15,"output_tokens":7}},"timestamp":"2026-04-30T12:01:01.000Z"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"exit 1","is_error":true}]},"timestamp":"2026-04-30T12:01:02.000Z"}
```

- [ ] **Step 7.3: Failing test**

`tests/unit/jsonl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseJsonlFile } from "@/lib/indexer/jsonl";

const fix = (n: string) => path.resolve(process.cwd(), "tests/fixtures", n);

describe("parseJsonlFile", () => {
  it("counts messages, tokens, errors on simple session", async () => {
    const r = await parseJsonlFile(fix("session-simple.jsonl"));
    expect(r.msgCount).toBe(3);
    expect(r.tokensIn).toBe(12);
    expect(r.tokensOut).toBe(3);
    expect(r.errorCount).toBe(0);
    expect(r.model).toBe("claude-opus-4-7");
  });
  it("detects is_error=true tool results", async () => {
    const r = await parseJsonlFile(fix("session-with-error.jsonl"));
    expect(r.errorCount).toBe(1);
  });
  it("yields message rows with role+content", async () => {
    const r = await parseJsonlFile(fix("session-simple.jsonl"));
    expect(r.messages.length).toBe(3);
    expect(r.messages[0].role).toBe("user");
    expect(r.messages[0].content).toContain("hi");
  });
});
```

- [ ] **Step 7.4: Implement**

`lib/indexer/jsonl.ts`:

```ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export type ParsedMessage = { ts: number; role: string; content: string };
export type ParseResult = {
  msgCount: number;
  tokensIn: number;
  tokensOut: number;
  errorCount: number;
  model: string | null;
  startedAt: number | null;
  lastMsgAt: number | null;
  messages: ParsedMessage[];
  endOffset: number;
};

function flattenContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  const parts: string[] = [];
  for (const c of content) {
    if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
    else if (c?.type === "tool_use") parts.push(`[tool:${c.name} ${JSON.stringify(c.input ?? {})}]`);
    else if (c?.type === "tool_result") parts.push(`[result:${typeof c.content === "string" ? c.content : JSON.stringify(c.content)}]`);
  }
  return parts.join("\n");
}

function isErrorToolResult(content: any): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((c: any) => c?.type === "tool_result" && c?.is_error === true);
}

export async function parseJsonlFile(filePath: string, fromOffset = 0): Promise<ParseResult> {
  const stream = createReadStream(filePath, { encoding: "utf8", start: fromOffset });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const r: ParseResult = {
    msgCount: 0, tokensIn: 0, tokensOut: 0, errorCount: 0,
    model: null, startedAt: null, lastMsgAt: null, messages: [], endOffset: fromOffset
  };
  let bytes = fromOffset;
  for await (const raw of rl) {
    bytes += Buffer.byteLength(raw, "utf8") + 1;
    const line = raw.trim();
    if (!line) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();
    const role = obj.message?.role ?? obj.type ?? "unknown";
    const content = flattenContent(obj.message?.content);
    r.messages.push({ ts, role, content });
    r.msgCount++;
    if (r.startedAt == null) r.startedAt = ts;
    r.lastMsgAt = ts;
    if (obj.message?.model && !r.model) r.model = obj.message.model;
    if (obj.message?.usage) {
      r.tokensIn  += obj.message.usage.input_tokens  ?? 0;
      r.tokensOut += obj.message.usage.output_tokens ?? 0;
    }
    if (isErrorToolResult(obj.message?.content)) r.errorCount++;
  }
  r.endOffset = bytes;
  return r;
}
```

- [ ] **Step 7.5: Run + Commit**

Run: `npm test -- tests/unit/jsonl.test.ts`. Expected: 3 passed.

```bash
git add lib/indexer/jsonl.ts tests/fixtures/ tests/unit/jsonl.test.ts
git commit -m "Add jsonl parser with token tally + error detection"
```

---

## Task 8: `lib/indexer/scan.ts` — full project/session scan

**Files:**
- Create: `lib/indexer/scan.ts`, `tests/integration/indexer.test.ts`

- [ ] **Step 8.1: Failing integration test**

`tests/integration/indexer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { scanAll } from "@/lib/indexer/scan";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ccdash-"));
  fs.mkdirSync(path.join(tmpHome, "projects/D--proj-a"), { recursive: true });
  fs.copyFileSync(
    path.resolve(process.cwd(), "tests/fixtures/session-simple.jsonl"),
    path.join(tmpHome, "projects/D--proj-a/aaa.jsonl")
  );
  process.env.CLAUDE_HOME   = tmpHome;
  process.env.DASHBOARD_DB  = path.join(tmpHome, "test.db");
});

afterEach(() => {
  _resetDbForTests();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.CLAUDE_HOME;
  delete process.env.DASHBOARD_DB;
});

describe("scanAll", () => {
  it("upserts projects and sessions, populates messages_fts", async () => {
    await scanAll();
    const db = getDb();
    const projects = db.prepare("SELECT * FROM projects").all() as any[];
    expect(projects.length).toBe(1);
    expect(projects[0].name).toBe("proj-a");
    const sessions = db.prepare("SELECT * FROM sessions").all() as any[];
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe("aaa");
    expect(sessions[0].msg_count).toBe(3);
    const ftsRows = db.prepare("SELECT count(*) c FROM messages_fts").get() as any;
    expect(ftsRows.c).toBe(3);
  });
  it("re-scan is idempotent", async () => {
    await scanAll();
    await scanAll();
    const ftsRows = getDb().prepare("SELECT count(*) c FROM messages_fts").get() as any;
    expect(ftsRows.c).toBe(3);
  });
});
```

- [ ] **Step 8.2: Implement**

`lib/indexer/scan.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { projectsDir } from "@/lib/paths";
import { parseJsonlFile } from "@/lib/indexer/jsonl";
import { bus } from "@/lib/bus";

function hashCwd(cwd: string): string {
  return crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 16);
}

function decodeProjectDir(name: string): string {
  if (/^[A-Za-z]-/.test(name)) {
    return name.replace(/^([A-Za-z])-(.*)/, (_, d, rest) => `${d}:\${rest.replace(/-/g, "\\")}`);
  }
  return "/" + name.replace(/^-/, "").replace(/-/g, "/");
}

function projectName(cwd: string): string {
  return path.basename(cwd.replace(/[\/]+$/, "")) || cwd;
}

export async function scanAll(): Promise<void> {
  const db = getDb();
  const root = projectsDir();
  let entries: string[] = [];
  try { entries = await fs.readdir(root); } catch { return; }
  const now = Date.now();

  const upsertProj = db.prepare(`
    INSERT INTO projects(id, cwd, name, first_seen, last_seen) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen
  `);
  const upsertSession = db.prepare(`
    INSERT INTO sessions(id, project_id, jsonl_path, started_at, last_msg_at, msg_count, tokens_in, tokens_out, model, status, tail_offset, error_count)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      last_msg_at=excluded.last_msg_at, msg_count=excluded.msg_count,
      tokens_in=excluded.tokens_in, tokens_out=excluded.tokens_out,
      model=COALESCE(excluded.model, sessions.model),
      tail_offset=excluded.tail_offset,
      error_count=excluded.error_count
  `);
  const deleteFts = db.prepare("DELETE FROM messages_fts WHERE session_id = ?");
  const insertFts = db.prepare("INSERT INTO messages_fts(session_id, role, content, ts) VALUES (?,?,?,?)");

  for (const dirName of entries) {
    const projDir = path.join(root, dirName);
    const stat = await fs.stat(projDir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const cwd = decodeProjectDir(dirName);
    const projId = hashCwd(cwd);
    upsertProj.run(projId, cwd, projectName(cwd), now, now);

    const files = (await fs.readdir(projDir)).filter(f => f.endsWith(".jsonl"));
    for (const f of files) {
      const sessionId = f.replace(/\.jsonl$/, "");
      const jsonlPath = path.join(projDir, f);
      const r = await parseJsonlFile(jsonlPath);
      upsertSession.run(
        sessionId, projId, jsonlPath,
        r.startedAt ?? now, r.lastMsgAt, r.msgCount,
        r.tokensIn, r.tokensOut, r.model, "idle",
        r.endOffset, r.errorCount
      );
      const tx = db.transaction(() => {
        deleteFts.run(sessionId);
        for (const m of r.messages) insertFts.run(sessionId, m.role, m.content, m.ts);
      });
      tx();
      bus.emit("session:new", { sessionId, projectId: projId });
    }
  }
}
```

- [ ] **Step 8.3: Run + Commit**

Run: `npm test -- tests/integration/indexer.test.ts`. Expected: 2 passed.

```bash
git add lib/indexer/scan.ts tests/integration/indexer.test.ts
git commit -m "Add full project/session scanner with FTS index"
```

---

## Task 9: `lib/indexer/live.ts` — live session heartbeat sync

**Files:**
- Create: `lib/indexer/live.ts`, `tests/integration/live.test.ts`

- [ ] **Step 9.1: Failing test**

`tests/integration/live.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { syncLiveOnce } from "@/lib/indexer/live";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ccdash-live-"));
  fs.mkdirSync(path.join(tmpHome, "sessions"), { recursive: true });
  process.env.CLAUDE_HOME  = tmpHome;
  process.env.DASHBOARD_DB = path.join(tmpHome, "t.db");
});
afterEach(() => {
  _resetDbForTests();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.CLAUDE_HOME; delete process.env.DASHBOARD_DB;
});

describe("syncLiveOnce", () => {
  it("upserts live_sessions from json files", async () => {
    fs.writeFileSync(
      path.join(tmpHome, "sessions/1234.json"),
      JSON.stringify({ pid: 1234, sessionId: "abc", cwd: "D:\proj", status: "busy", updatedAt: Date.now() })
    );
    await syncLiveOnce();
    const rows = getDb().prepare("SELECT * FROM live_sessions").all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("abc");
  });
  it("removes stale rows when file deleted", async () => {
    const f = path.join(tmpHome, "sessions/1.json");
    fs.writeFileSync(f, JSON.stringify({ pid: 1, sessionId: "x", cwd: "/p", status: "idle", updatedAt: Date.now() }));
    await syncLiveOnce();
    fs.unlinkSync(f);
    await syncLiveOnce();
    const rows = getDb().prepare("SELECT * FROM live_sessions").all();
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 9.2: Implement**

`lib/indexer/live.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { sessionsDir } from "@/lib/paths";
import { bus } from "@/lib/bus";

let timer: NodeJS.Timeout | null = null;

export async function syncLiveOnce(): Promise<void> {
  const db = getDb();
  const dir = sessionsDir();
  let entries: string[] = [];
  try { entries = (await fs.readdir(dir)).filter(f => f.endsWith(".json")); } catch { entries = []; }

  const seen = new Set<number>();
  const upsert = db.prepare(`
    INSERT INTO live_sessions(pid, session_id, cwd, status, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(pid) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
  `);
  for (const f of entries) {
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf8");
      const j = JSON.parse(raw);
      if (!j.pid || !j.sessionId) continue;
      seen.add(j.pid);
      upsert.run(j.pid, j.sessionId, j.cwd, j.status ?? null, j.updatedAt ?? Date.now());
    } catch { }
  }

  const existing = db.prepare("SELECT pid FROM live_sessions").all() as { pid: number }[];
  const remove = db.prepare("DELETE FROM live_sessions WHERE pid = ?");
  for (const e of existing) {
    if (!seen.has(e.pid)) {
      remove.run(e.pid);
      bus.emit("live:gone", { pid: e.pid });
    }
  }
  bus.emit("live:change", { count: seen.size });
}

export function startLivePolling(intervalMs = 2000) {
  if (timer) return;
  syncLiveOnce().catch(() => {});
  timer = setInterval(() => { syncLiveOnce().catch(() => {}); }, intervalMs);
}

export function stopLivePolling() {
  if (timer) { clearInterval(timer); timer = null; }
}
```

- [ ] **Step 9.3: Run + Commit**

Run: `npm test -- tests/integration/live.test.ts`. Expected: 2 passed.

```bash
git add lib/indexer/live.ts tests/integration/live.test.ts
git commit -m "Add live session heartbeat sync"
```

---

## Task 10: `lib/health/face.ts` + `lib/health/compute.ts`

**Files:**
- Create: `lib/health/face.ts`, `lib/health/compute.ts`, `tests/unit/face.test.ts`, `tests/unit/health.test.ts`

- [ ] **Step 10.1: Failing tests**

`tests/unit/face.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { faceForHp } from "@/lib/health/face";

describe("faceForHp", () => {
  it.each([
    [100, "(◕‿◕)"], [80, "(◕‿◕)"],
    [79, "(•ᴗ•)"],  [50, "(•ᴗ•)"],
    [49, "(-_-)"],  [25, "(-_-)"],
    [24, "(╥﹏╥)"],  [0, "(╥﹏╥)"]
  ])("hp=%i -> %s", (hp, face) => {
    expect(faceForHp(hp)).toBe(face);
  });
});
```

`tests/unit/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeSessionHealth } from "@/lib/health/compute";

const W = { activity: 0.4, errors: 0.3, watcher: 0.2, tokens: 0.1 };

describe("computeSessionHealth", () => {
  it("fresh activity, no errors, ok watcher, low tokens => high HP", () => {
    const r = computeSessionHealth({
      lastMsgAt: Date.now() - 60_000, errorCount: 0, msgCount: 10,
      latestWatcherStatus: "ok", tokens: 1000, quotaThreshold: 5_000_000
    }, W);
    expect(r.hp).toBeGreaterThanOrEqual(95);
  });
  it("week-old, many errors, alert watcher, near-quota => low HP", () => {
    const r = computeSessionHealth({
      lastMsgAt: Date.now() - 7 * 86400_000, errorCount: 5, msgCount: 5,
      latestWatcherStatus: "alert", tokens: 4_900_000, quotaThreshold: 5_000_000
    }, W);
    expect(r.hp).toBeLessThan(20);
  });
  it("clamps to 0..100", () => {
    const r = computeSessionHealth({
      lastMsgAt: Date.now() + 100_000_000, errorCount: 0, msgCount: 1,
      latestWatcherStatus: "none", tokens: 0, quotaThreshold: 1
    }, W);
    expect(r.hp).toBeLessThanOrEqual(100);
    expect(r.hp).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 10.2: Implement face**

`lib/health/face.ts`:

```ts
export function faceForHp(hp: number): string {
  if (hp >= 80) return "(◕‿◕)";
  if (hp >= 50) return "(•ᴗ•)";
  if (hp >= 25) return "(-_-)";
  return "(╥﹏╥)";
}
```

- [ ] **Step 10.3: Implement compute**

`lib/health/compute.ts`:

```ts
import { faceForHp } from "@/lib/health/face";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type HealthInput = {
  lastMsgAt: number | null;
  errorCount: number;
  msgCount: number;
  latestWatcherStatus: "ok" | "alert" | "error" | "none";
  tokens: number;
  quotaThreshold: number;
};
export type Weights = { activity: number; errors: number; watcher: number; tokens: number };
export type HealthResult = {
  hp: number; activityPct: number; errorPct: number; watcherPct: number; tokensPct: number; face: string;
};

const clamp01  = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.round(Math.max(0, Math.min(100, n)));

export function computeSessionHealth(input: HealthInput, w: Weights): HealthResult {
  const now = Date.now();
  const sinceMs = input.lastMsgAt == null ? Infinity : now - input.lastMsgAt;
  const activity = clamp01(1 - sinceMs / WEEK_MS) * 100;
  const errorRatio = input.errorCount / Math.max(input.msgCount, 1);
  const errors = clamp01(1 - errorRatio) * 100;
  const watcher = input.latestWatcherStatus === "ok"    ? 100
                : input.latestWatcherStatus === "alert" ? 20
                : input.latestWatcherStatus === "error" ? 50
                :                                          70;
  const tokens = (1 - clamp01(input.tokens / Math.max(input.quotaThreshold, 1))) * 100;
  const hp = clamp100(w.activity * activity + w.errors * errors + w.watcher * watcher + w.tokens * tokens);
  return {
    hp,
    activityPct: clamp100(activity),
    errorPct:    clamp100(errors),
    watcherPct:  clamp100(watcher),
    tokensPct:   clamp100(tokens),
    face: faceForHp(hp)
  };
}
```

- [ ] **Step 10.4: Run + Commit**

Run: `npm test -- tests/unit/face.test.ts tests/unit/health.test.ts`. Expected: all pass.

```bash
git add lib/health/face.ts lib/health/compute.ts tests/unit/face.test.ts tests/unit/health.test.ts
git commit -m "Add health computation + face mapping"
```

---

## Task 11: `lib/health/recompute.ts` — write to `pet_health`

**Files:**
- Create: `lib/health/recompute.ts`, `tests/integration/recompute.test.ts`

- [ ] **Step 11.1: Failing test**

`tests/integration/recompute.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { recomputeSessionHealth, recomputeProjectHealth } from "@/lib/health/recompute";

beforeEach(() => { process.env.DASHBOARD_DB = path.join(os.tmpdir(), `health-${Date.now()}.db`); });
afterEach(() => {
  _resetDbForTests();
  if (process.env.DASHBOARD_DB && fs.existsSync(process.env.DASHBOARD_DB)) fs.unlinkSync(process.env.DASHBOARD_DB);
  delete process.env.DASHBOARD_DB;
});

describe("recompute", () => {
  it("writes pet_health row for a session", () => {
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p1","D:\x","x",1,1);
    db.prepare(`INSERT INTO sessions(id,project_id,jsonl_path,started_at,last_msg_at,msg_count,tokens_in,tokens_out,model,status,tail_offset,error_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run("s1","p1","/x.jsonl",1, Date.now()-60000, 5, 100, 50, "claude-opus-4-7", "idle", 0, 0);
    recomputeSessionHealth("s1");
    const row = db.prepare("SELECT * FROM pet_health WHERE scope='session' AND target_id='s1'").get() as any;
    expect(row.hp).toBeGreaterThan(0);
    expect(row.face.length).toBeGreaterThan(2);
  });
  it("project HP = max of session HPs (default)", () => {
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p1","D:\x","x",1,1);
    const insS = db.prepare(`INSERT INTO sessions(id,project_id,jsonl_path,started_at,last_msg_at,msg_count,tokens_in,tokens_out,model,status,tail_offset,error_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    insS.run("a","p1","/x.jsonl",1, Date.now()-60000,        5, 100, 50, "m", "idle", 0, 0);
    insS.run("b","p1","/y.jsonl",1, Date.now()-7*86400000,   5, 100, 50, "m", "idle", 0, 5);
    recomputeSessionHealth("a"); recomputeSessionHealth("b");
    recomputeProjectHealth("p1");
    const a = db.prepare("SELECT hp FROM pet_health WHERE target_id='a'").get() as any;
    const b = db.prepare("SELECT hp FROM pet_health WHERE target_id='b'").get() as any;
    const p = db.prepare("SELECT hp FROM pet_health WHERE target_id='p1'").get() as any;
    expect(p.hp).toBe(Math.max(a.hp, b.hp));
  });
});
```

- [ ] **Step 11.2: Implement**

`lib/health/recompute.ts`:

```ts
import { getDb } from "@/lib/db";
import { computeSessionHealth, type Weights } from "@/lib/health/compute";
import { faceForHp } from "@/lib/health/face";
import { bus } from "@/lib/bus";

function readSettings() {
  const db = getDb();
  const get = (k: string, fb: string) =>
    (db.prepare("SELECT value FROM settings WHERE key=?").get(k) as any)?.value ?? fb;
  const weights = JSON.parse(get("health_weights", '{"activity":0.4,"errors":0.3,"watcher":0.2,"tokens":0.1}')) as Weights;
  const quota = parseInt(get("quota_threshold", "5000000"), 10);
  const strategy = get("project_hp_strategy", "max") as "max" | "avg";
  return { weights, quota, strategy };
}

export function recomputeSessionHealth(sessionId: string) {
  const db = getDb();
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(sessionId) as any;
  if (!s) return;
  const last = db.prepare(`SELECT status FROM watcher_runs
    WHERE watcher_id IN (SELECT id FROM watchers WHERE scope='session' AND target_id=?)
    ORDER BY started_at DESC LIMIT 1`).get(sessionId) as any;
  const { weights, quota } = readSettings();
  const r = computeSessionHealth({
    lastMsgAt: s.last_msg_at, errorCount: s.error_count ?? 0, msgCount: s.msg_count ?? 1,
    latestWatcherStatus: (last?.status ?? "none") as any,
    tokens: (s.tokens_in ?? 0) + (s.tokens_out ?? 0),
    quotaThreshold: quota
  }, weights);
  db.prepare(`INSERT INTO pet_health(scope,target_id,hp,activity_pct,error_pct,watcher_pct,tokens_pct,face,ai_advice,computed_at)
              VALUES('session',?,?,?,?,?,?,?,(SELECT ai_advice FROM pet_health WHERE scope='session' AND target_id=?),?)
              ON CONFLICT(scope,target_id) DO UPDATE SET
                hp=excluded.hp, activity_pct=excluded.activity_pct, error_pct=excluded.error_pct,
                watcher_pct=excluded.watcher_pct, tokens_pct=excluded.tokens_pct, face=excluded.face,
                computed_at=excluded.computed_at`)
    .run(sessionId, r.hp, r.activityPct, r.errorPct, r.watcherPct, r.tokensPct, r.face, sessionId, Date.now());
  bus.emit("health:change", { scope: "session", targetId: sessionId, hp: r.hp });
}

export function recomputeProjectHealth(projectId: string) {
  const db = getDb();
  const { strategy } = readSettings();
  const rows = db.prepare(`SELECT ph.hp FROM pet_health ph JOIN sessions s ON s.id=ph.target_id
                           WHERE ph.scope='session' AND s.project_id=?`).all(projectId) as any[];
  if (rows.length === 0) return;
  const hp = strategy === "avg"
    ? Math.round(rows.reduce((a, r) => a + r.hp, 0) / rows.length)
    : Math.max(...rows.map(r => r.hp));
  db.prepare(`INSERT INTO pet_health(scope,target_id,hp,face,computed_at) VALUES('project',?,?,?,?)
              ON CONFLICT(scope,target_id) DO UPDATE SET hp=excluded.hp, face=excluded.face, computed_at=excluded.computed_at`)
    .run(projectId, hp, faceForHp(hp), Date.now());
  bus.emit("health:change", { scope: "project", targetId: projectId, hp });
}
```

- [ ] **Step 11.3: Run + Commit**

```bash
npm test -- tests/integration/recompute.test.ts
git add lib/health/recompute.ts tests/integration/recompute.test.ts
git commit -m "Add session+project health recompute writers"
```

---

## Task 12: `lib/ai/runClaude.ts` + `scripts/fake-claude.cjs`

**Files:**
- Create: `lib/ai/runClaude.ts`, `scripts/fake-claude.cjs`, `tests/integration/runClaude.test.ts`

- [ ] **Step 12.1: Fake claude binary**

`scripts/fake-claude.cjs`:

```js
#!/usr/bin/env node
// Echo a canned JSON envelope for tests; usage: fake-claude -p "prompt"
const args = process.argv.slice(2);
const idx = args.indexOf("-p");
const prompt = idx >= 0 ? args[idx+1] : "";
const env = process.env.FAKE_CLAUDE_ENV || "ok";
if (env === "alert") {
  process.stdout.write(JSON.stringify({ status: "alert", message: "pretend bad", recommendation: "fix" }));
} else if (env === "timeout") {
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(JSON.stringify({ status: "ok", title: "stub", summary: "stub summary", recommendation: "none", message: prompt.slice(0,40) }));
}
```

- [ ] **Step 12.2: Failing test**

`tests/integration/runClaude.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { runClaude } from "@/lib/ai/runClaude";

const fake = path.resolve(process.cwd(), "scripts/fake-claude.cjs");

describe("runClaude", () => {
  it("captures stdout JSON from fake binary", async () => {
    const r = await runClaude({ prompt: "hello", cwd: process.cwd(), bin: process.execPath, args: [fake], timeoutMs: 5000 });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).status).toBe("ok");
  });
  it("returns timeout=true if process hangs", async () => {
    process.env.FAKE_CLAUDE_ENV = "timeout";
    const r = await runClaude({ prompt: "x", cwd: process.cwd(), bin: process.execPath, args: [fake], timeoutMs: 500 });
    expect(r.timedOut).toBe(true);
    delete process.env.FAKE_CLAUDE_ENV;
  });
});
```

- [ ] **Step 12.3: Implement**

`lib/ai/runClaude.ts`:

```ts
import { spawn } from "node:child_process";
import treeKill from "tree-kill";

export type RunOpts = {
  prompt: string;
  cwd: string;
  bin?: string;
  args?: string[];
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
};
export type RunResult = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean };

export function runClaude(o: RunOpts): Promise<RunResult> {
  return new Promise((resolve) => {
    const bin = o.bin ?? process.env.CLAUDE_BIN ?? "claude";
    const args = [...(o.args ?? []), "-p", o.prompt];
    const child = spawn(bin, args, { cwd: o.cwd, shell: false, env: process.env });
    let stdout = ""; let stderr = ""; let timedOut = false;
    child.stdout.on("data", b => { const s = b.toString("utf8"); stdout += s; o.onStdout?.(s); });
    child.stderr.on("data", b => { stderr += b.toString("utf8"); });
    const t = setTimeout(() => { timedOut = true; if (child.pid) treeKill(child.pid); }, o.timeoutMs ?? 600_000);
    child.on("close", code => { clearTimeout(t); resolve({ exitCode: code, stdout, stderr, timedOut }); });
    child.on("error", () => { clearTimeout(t); resolve({ exitCode: null, stdout, stderr, timedOut }); });
  });
}
```

- [ ] **Step 12.4: Run + Commit**

```bash
npm test -- tests/integration/runClaude.test.ts
git add lib/ai/runClaude.ts scripts/fake-claude.cjs tests/integration/runClaude.test.ts
git commit -m "Add runClaude spawn helper + fake binary for tests"
```

---

## Task 13: `lib/ai/summarize.ts`

**Files:**
- Create: `lib/ai/summarize.ts`, `tests/integration/summarize.test.ts`

- [ ] **Step 13.1: Failing test**

`tests/integration/summarize.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { summarizeSession } from "@/lib/ai/summarize";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sum-"));
  process.env.DASHBOARD_DB = path.join(tmp, "t.db");
});
afterEach(() => {
  _resetDbForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DASHBOARD_DB;
});

describe("summarizeSession", () => {
  it("writes summary using fake claude bin", async () => {
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p","/p","p",1,1);
    db.prepare(`INSERT INTO sessions(id,project_id,jsonl_path,started_at,msg_count) VALUES('s','p',?,1,5)`)
      .run(path.resolve(process.cwd(), "tests/fixtures/session-simple.jsonl"));
    await summarizeSession("s", { bin: process.execPath, args: [path.resolve(process.cwd(), "scripts/fake-claude.cjs")] });
    const row = db.prepare("SELECT * FROM summaries WHERE session_id='s'").get() as any;
    expect(row.title).toBe("stub");
    expect(row.summary).toBe("stub summary");
  });
});
```

- [ ] **Step 13.2: Implement**

`lib/ai/summarize.ts`:

```ts
import fs from "node:fs/promises";
import { getDb } from "@/lib/db";
import { runClaude } from "@/lib/ai/runClaude";
import { bus } from "@/lib/bus";

export type SummarizeOpts = { bin?: string; args?: string[]; timeoutMs?: number };

const PROMPT_HEADER = `You are summarizing a Claude Code session for a dashboard.`;
const PROMPT_FOOTER = `Reply ONLY with JSON: {"title":"<8 words max>","summary":"<2-3 sentences>","recommendation":"<1 sentence or 'none'>","why_low_hp":null,"advice":null}`;
const MAX_TAIL_BYTES = 40_000;

export async function summarizeSession(sessionId: string, opts: SummarizeOpts = {}) {
  const db = getDb();
  const s = db.prepare(`SELECT s.*, p.cwd AS pcwd, p.name AS pname
                        FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?`).get(sessionId) as any;
  if (!s) throw new Error(`session ${sessionId} not found`);
  let tail = "";
  try {
    const buf = await fs.readFile(s.jsonl_path, "utf8");
    tail = buf.length > MAX_TAIL_BYTES ? buf.slice(-MAX_TAIL_BYTES) : buf;
  } catch { tail = "(could not read jsonl)"; }

  const prompt = `${PROMPT_HEADER}
Project: ${s.pname} (${s.pcwd})
Session: ${s.id} (${s.msg_count} turns, started ${new Date(s.started_at).toISOString()})

Recent jsonl excerpt:
${tail}

${PROMPT_FOOTER}`;

  const r = await runClaude({ prompt, cwd: s.pcwd, bin: opts.bin, args: opts.args, timeoutMs: opts.timeoutMs ?? 120_000 });
  let parsed: any = {};
  try {
    const m = r.stdout.match(/\{[\s\S]*\}\s*$/);
    parsed = JSON.parse(m ? m[0] : r.stdout);
  } catch {
    parsed = { title: "(parse failed)", summary: r.stdout.slice(0, 400), recommendation: "none" };
  }

  db.prepare(`INSERT INTO summaries(session_id,title,summary,recommendation,generated_at,generator)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(session_id) DO UPDATE SET title=excluded.title,summary=excluded.summary,
                recommendation=excluded.recommendation,generated_at=excluded.generated_at,generator=excluded.generator`)
    .run(sessionId, parsed.title ?? null, parsed.summary ?? null, parsed.recommendation ?? null, Date.now(), "claude -p");

  db.prepare("DELETE FROM summaries_fts WHERE session_id=?").run(sessionId);
  db.prepare("INSERT INTO summaries_fts(session_id,title,summary,recommendation) VALUES (?,?,?,?)")
    .run(sessionId, parsed.title ?? "", parsed.summary ?? "", parsed.recommendation ?? "");

  if (parsed.advice) {
    db.prepare("UPDATE pet_health SET ai_advice=? WHERE scope='session' AND target_id=?").run(parsed.advice, sessionId);
  }

  const vault = (db.prepare("SELECT value FROM settings WHERE key='obsidian_vault_path'").get() as any)?.value;
  if (vault) {
    const { appendDailyNote } = await import("@/lib/obsidian/writer");
    await appendDailyNote(vault, {
      project: s.pname,
      sessionShort: sessionId.slice(0, 8),
      time: new Date().toLocaleTimeString(),
      title: parsed.title,
      summary: parsed.summary,
      recommendation: parsed.recommendation
    }).catch(() => {});
  }

  bus.emit("feed:new", { kind: "summary_ready", sessionId, projectId: s.project_id });
}
```

- [ ] **Step 13.3: Run + Commit**

```bash
npm test -- tests/integration/summarize.test.ts
git add lib/ai/summarize.ts tests/integration/summarize.test.ts
git commit -m "Add session summarizer using claude -p"
```

---

## Task 14: `lib/scheduler/{runner,cron,events}.ts` — watcher engine

**Files:**
- Create: `lib/scheduler/runner.ts`, `lib/scheduler/cron.ts`, `lib/scheduler/events.ts`, `tests/integration/runner.test.ts`

- [ ] **Step 14.1: Failing test**

`tests/integration/runner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { runWatcher } from "@/lib/scheduler/runner";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-")); process.env.DASHBOARD_DB = path.join(tmp, "t.db"); });
afterEach(() => {
  _resetDbForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DASHBOARD_DB; delete process.env.FAKE_CLAUDE_ENV;
});

describe("runWatcher", () => {
  it("ok status writes watcher_run + feed", async () => {
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p","/p","p",1,1);
    const w = db.prepare(`INSERT INTO watchers(scope,target_id,name,prompt,trigger_kind,trigger_value,enabled,created_at)
                          VALUES('project','p','w','say hi','cron','* * * * *',1,?)`).run(Date.now()).lastInsertRowid as number;
    await runWatcher(w, { bin: process.execPath, args: [path.resolve(process.cwd(),"scripts/fake-claude.cjs")] });
    const run = db.prepare("SELECT * FROM watcher_runs WHERE watcher_id=?").get(w) as any;
    expect(run.status).toBe("ok");
    const feed = db.prepare("SELECT * FROM feed WHERE kind='watcher_done'").all();
    expect(feed.length).toBe(1);
  });
  it("alert status writes feed kind=watcher_alert", async () => {
    process.env.FAKE_CLAUDE_ENV = "alert";
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p","/p","p",1,1);
    const w = db.prepare(`INSERT INTO watchers(scope,target_id,name,prompt,trigger_kind,trigger_value,enabled,created_at)
                          VALUES('project','p','w','x','cron','* * * * *',1,?)`).run(Date.now()).lastInsertRowid as number;
    await runWatcher(w, { bin: process.execPath, args: [path.resolve(process.cwd(),"scripts/fake-claude.cjs")] });
    const feed = db.prepare("SELECT * FROM feed WHERE kind='watcher_alert'").get() as any;
    expect(feed).toBeTruthy();
  });
});
```

- [ ] **Step 14.2: Implement runner**

`lib/scheduler/runner.ts`:

```ts
import { getDb } from "@/lib/db";
import { runClaude } from "@/lib/ai/runClaude";
import { bus } from "@/lib/bus";
import { postWebhook } from "@/lib/notify/webhook";

export type RunOpts = { bin?: string; args?: string[]; timeoutMs?: number };

let activeWatchers = 0;
function caps() {
  const v = (getDb().prepare("SELECT value FROM settings WHERE key='concurrency_caps'").get() as any)?.value
         ?? '{"watchers":3,"summaries":2}';
  return JSON.parse(v) as { watchers: number; summaries: number };
}

function targetCwd(scope: string, targetId: string | null): string {
  const db = getDb();
  if (scope === "project") return (db.prepare("SELECT cwd FROM projects WHERE id=?").get(targetId) as any)?.cwd ?? process.cwd();
  if (scope === "session") return (db.prepare("SELECT p.cwd FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?").get(targetId) as any)?.cwd ?? process.cwd();
  return process.cwd();
}

export async function runWatcher(watcherId: number, opts: RunOpts = {}, ctx?: any): Promise<void> {
  const db = getDb();
  const w = db.prepare("SELECT * FROM watchers WHERE id=?").get(watcherId) as any;
  if (!w || !w.enabled) return;
  if (activeWatchers >= caps().watchers) {
    bus.emit("feed:new", { kind: "watcher_skipped_capacity", watcherId });
    return;
  }
  activeWatchers++;
  const startedAt = Date.now();
  const runId = db.prepare(`INSERT INTO watcher_runs(watcher_id,started_at,status) VALUES (?,?,?)`)
    .run(watcherId, startedAt, "running").lastInsertRowid as number;
  bus.emit("watcher:run-started", { watcherId, runId });
  try {
    const cwd = targetCwd(w.scope, w.target_id);
    const prompt = `You are a watcher named "${w.name}" (scope=${w.scope}).
User instruction: ${w.prompt}
Context: ${JSON.stringify(ctx ?? {})}
Reply ONLY with JSON: {"status":"ok"|"alert","message":"<1 sentence>","recommendation":"<1 sentence or 'none'>"}`;
    const r = await runClaude({ prompt, cwd, bin: opts.bin, args: opts.args, timeoutMs: opts.timeoutMs ?? 600_000 });

    let parsed: any = {};
    try {
      const m = r.stdout.match(/\{[\s\S]*\}\s*$/);
      parsed = JSON.parse(m ? m[0] : r.stdout);
    } catch { parsed = { status: "error", message: "could not parse claude JSON" }; }
    if (r.timedOut) parsed = { status: "error", message: "timeout" };
    if (r.exitCode !== 0 && !r.timedOut && !parsed.status) parsed = { status: "error", message: r.stderr.slice(-200) || "non-zero exit" };
    const status: "ok" | "alert" | "error" =
      parsed.status === "ok" || parsed.status === "alert" || parsed.status === "error" ? parsed.status : "error";

    db.prepare(`UPDATE watcher_runs SET ended_at=?, status=?, output=?, alert_msg=? WHERE id=?`)
      .run(Date.now(), status, r.stdout.slice(-4000), parsed.message ?? null, runId);

    db.prepare(`INSERT INTO feed(ts,kind,project_id,session_id,payload) VALUES(?,?,?,?,?)`)
      .run(Date.now(),
           status === "alert" ? "watcher_alert" : "watcher_done",
           w.scope === "project" ? w.target_id : null,
           w.scope === "session" ? w.target_id : null,
           JSON.stringify({ watcherId, name: w.name, status, message: parsed.message, recommendation: parsed.recommendation }));

    bus.emit(status === "alert" ? "watcher:alert" : "watcher:done", { watcherId, runId, status });

    if (status === "alert") {
      const url = w.notify_webhook ?? (db.prepare("SELECT value FROM settings WHERE key='notify_webhook'").get() as any)?.value;
      if (url) await postWebhook(url, { watcher: w.name, scope: w.scope, target_id: w.target_id, message: parsed.message, recommendation: parsed.recommendation, ts: Date.now() }).catch(() => {});
    }

    const vault = (db.prepare("SELECT value FROM settings WHERE key='obsidian_vault_path'").get() as any)?.value;
    if (vault) {
      const { appendDailyNote } = await import("@/lib/obsidian/writer");
      await appendDailyNote(vault, {
        project: w.scope === "project" ? (db.prepare("SELECT name FROM projects WHERE id=?").get(w.target_id) as any)?.name ?? "?" : "global",
        sessionShort: w.scope === "session" ? String(w.target_id).slice(0, 8) : "—",
        time: new Date().toLocaleTimeString(),
        title: `watcher ${w.name}`,
        summary: parsed.message ?? null,
        recommendation: parsed.recommendation ?? null,
        watcherAlert: status === "alert" ? parsed.message : undefined
      }).catch(() => {});
    }
  } finally {
    activeWatchers--;
  }
}
```


- [ ] **Step 14.3: Implement cron registry**

`lib/scheduler/cron.ts`:

```ts
import cron, { ScheduledTask } from "node-cron";
import { runWatcher } from "@/lib/scheduler/runner";
import { getDb } from "@/lib/db";

const jobs = new Map<number, ScheduledTask>();

export function registerCronWatcher(w: { id: number; trigger_kind: string; trigger_value: string; enabled: number }) {
  jobs.get(w.id)?.stop();
  if (w.trigger_kind !== "cron" || !w.enabled) return;
  if (!cron.validate(w.trigger_value)) return;
  const t = cron.schedule(w.trigger_value, () => { runWatcher(w.id).catch(() => {}); });
  jobs.set(w.id, t);
}

export function unregisterCron(id: number) {
  jobs.get(id)?.stop();
  jobs.delete(id);
}

export function reloadAllCronWatchers() {
  for (const t of jobs.values()) t.stop();
  jobs.clear();
  const all = getDb().prepare("SELECT id, trigger_kind, trigger_value, enabled FROM watchers WHERE trigger_kind='cron'").all() as any[];
  all.forEach(registerCronWatcher);
}
```

- [ ] **Step 14.4: Implement event router**

`lib/scheduler/events.ts`:

```ts
import { bus } from "@/lib/bus";
import { getDb } from "@/lib/db";
import { runWatcher } from "@/lib/scheduler/runner";

const EVENT_MAP: Record<string, string> = {
  "on:session_new":  "session:new",
  "on:session_msg":  "session:msg",
  "on:error":        "session:error",
  "on:plan_change":  "plan:change",
  "on:todo_change":  "todo:change"
};

export function startEventRouter() {
  const get = () => getDb().prepare(
    "SELECT id, target_id, scope, trigger_value FROM watchers WHERE trigger_kind='event' AND enabled=1"
  ).all() as any[];
  for (const evt of new Set(Object.values(EVENT_MAP))) {
    bus.on(evt, (ctx: any) => {
      for (const w of get()) {
        if (EVENT_MAP[w.trigger_value] !== evt) continue;
        if (w.scope === "session" && ctx?.sessionId && w.target_id !== ctx.sessionId) continue;
        if (w.scope === "project" && ctx?.projectId && w.target_id !== ctx.projectId) continue;
        runWatcher(w.id, {}, ctx).catch(() => {});
      }
    });
  }
}
```

- [ ] **Step 14.5: Run + Commit**

```bash
npm test -- tests/integration/runner.test.ts
git add lib/scheduler/ tests/integration/runner.test.ts
git commit -m "Add watcher runner + cron registry + event router"
```

---

## Task 15: `lib/notify/webhook.ts`

**Files:**
- Create: `lib/notify/webhook.ts`, `tests/integration/webhook.test.ts`

- [ ] **Step 15.1: Failing test**

`tests/integration/webhook.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it } from "vitest";
import { postWebhook } from "@/lib/notify/webhook";

describe("postWebhook", () => {
  it("POSTs JSON body and resolves true on 2xx", async () => {
    const got: any[] = [];
    const server = http.createServer((req, res) => {
      let body = ""; req.on("data", c => body += c);
      req.on("end", () => { got.push(JSON.parse(body)); res.writeHead(200).end("ok"); });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const ok = await postWebhook(`http://127.0.0.1:${port}/`, { hello: "world" });
    server.close();
    expect(ok).toBe(true);
    expect(got[0].hello).toBe("world");
  });
  it("retries once then resolves false on permanent fail", async () => {
    const ok = await postWebhook("http://127.0.0.1:1/", { x: 1 });
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 15.2: Implement**

`lib/notify/webhook.ts`:

```ts
export async function postWebhook(url: string, payload: any): Promise<boolean> {
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (res.ok) return true;
    } catch { }
    if (attempt === 0) await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
```

- [ ] **Step 15.3: Run + Commit**

```bash
npm test -- tests/integration/webhook.test.ts
git add lib/notify/webhook.ts tests/integration/webhook.test.ts
git commit -m "Add webhook poster with single retry"
```

---

## Task 16: `lib/watcher/{fs,debounce}.ts` — chokidar fs watcher

**Files:**
- Create: `lib/watcher/fs.ts`, `lib/watcher/debounce.ts`, `tests/integration/watcher-fs.test.ts`

- [ ] **Step 16.1: Implement debounce**

`lib/watcher/debounce.ts`:

```ts
export function debounce<F extends (...a: any[]) => void>(fn: F, ms: number): F {
  let t: NodeJS.Timeout | null = null;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as F;
}
```

- [ ] **Step 16.2: Failing integration test**

`tests/integration/watcher-fs.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startFsWatcher, stopFsWatcher } from "@/lib/watcher/fs";
import { _resetDbForTests } from "@/lib/db";
import { bus } from "@/lib/bus";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
  fs.mkdirSync(path.join(tmp, "projects/D--p"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "sessions"), { recursive: true });
  process.env.CLAUDE_HOME  = tmp;
  process.env.DASHBOARD_DB = path.join(tmp, "t.db");
});
afterEach(async () => {
  await stopFsWatcher(); _resetDbForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CLAUDE_HOME; delete process.env.DASHBOARD_DB;
});

describe("fs watcher", () => {
  it("emits session:new when a new jsonl appears", async () => {
    const got: any[] = [];
    bus.on("session:new", d => got.push(d));
    await startFsWatcher();
    await new Promise(r => setTimeout(r, 200));
    fs.writeFileSync(
      path.join(tmp, "projects/D--p/new.jsonl"),
      '{"type":"user","timestamp":"2026-04-30T12:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n'
    );
    await new Promise(r => setTimeout(r, 800));
    expect(got.some((g: any) => g.sessionId === "new")).toBe(true);
  });
});
```

- [ ] **Step 16.3: Implement**

`lib/watcher/fs.ts`:

```ts
import chokidar, { FSWatcher } from "chokidar";
import path from "node:path";
import crypto from "node:crypto";
import { plansDir, projectsDir, sessionsDir, todosDir, tasksDir } from "@/lib/paths";
import { bus } from "@/lib/bus";
import { debounce } from "@/lib/watcher/debounce";
import { parseJsonlFile } from "@/lib/indexer/jsonl";
import { getDb } from "@/lib/db";

let watcher: FSWatcher | null = null;

async function onJsonlChange(filePath: string) {
  const sessionId = path.basename(filePath, ".jsonl");
  const projectDirName = path.basename(path.dirname(filePath));
  const cwd = projectDirName.replace(/^([A-Za-z])-/, "$1:\\").replace(/-/g, "\\");
  const projectId = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 16);
  const db = getDb();
  const existed = db.prepare("SELECT id, tail_offset FROM sessions WHERE id=?").get(sessionId) as any;
  const fromOffset = existed ? existed.tail_offset : 0;
  const r = await parseJsonlFile(filePath, fromOffset);
  if (r.msgCount === 0 && existed) return;

  db.prepare(`INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen`)
    .run(projectId, cwd, path.basename(cwd), Date.now(), Date.now());

  db.prepare(`INSERT INTO sessions(id,project_id,jsonl_path,started_at,last_msg_at,msg_count,tokens_in,tokens_out,model,status,tail_offset,error_count)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                last_msg_at=COALESCE(excluded.last_msg_at, sessions.last_msg_at),
                msg_count=sessions.msg_count + excluded.msg_count,
                tokens_in=sessions.tokens_in + excluded.tokens_in,
                tokens_out=sessions.tokens_out + excluded.tokens_out,
                model=COALESCE(excluded.model, sessions.model),
                tail_offset=excluded.tail_offset,
                error_count=sessions.error_count + excluded.error_count`)
    .run(sessionId, projectId, filePath, r.startedAt ?? Date.now(), r.lastMsgAt, r.msgCount, r.tokensIn, r.tokensOut, r.model, "active", r.endOffset, r.errorCount);

  const ins = db.prepare("INSERT INTO messages_fts(session_id,role,content,ts) VALUES (?,?,?,?)");
  const tx = db.transaction(() => { for (const m of r.messages) ins.run(sessionId, m.role, m.content, m.ts); });
  tx();

  if (!existed) bus.emit("session:new", { sessionId, projectId });
  for (const m of r.messages) {
    bus.emit("session:msg", { sessionId, projectId, role: m.role, content: m.content, ts: m.ts });
    if (m.content.startsWith("[result:") && m.content.includes('"is_error":true')) bus.emit("session:error", { sessionId, projectId });
  }
}

const onJsonlDebounced = debounce((p: string) => { onJsonlChange(p).catch(() => {}); }, 250);

function classify(p: string) {
  if (p.endsWith(".jsonl")) onJsonlDebounced(p);
  else if (p.includes(`${path.sep}plans${path.sep}`)) bus.emit("plan:change", { path: p });
  else if (p.includes(`${path.sep}todos${path.sep}`)) bus.emit("todo:change", { path: p });
  else if (p.includes(`${path.sep}tasks${path.sep}`)) bus.emit("task:change", { path: p });
}

export async function startFsWatcher(): Promise<void> {
  if (watcher) return;
  watcher = chokidar.watch([projectsDir(), sessionsDir(), plansDir(), todosDir(), tasksDir()], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    depth: 4
  });
  watcher.on("add",    classify);
  watcher.on("change", classify);
}

export async function stopFsWatcher(): Promise<void> {
  await watcher?.close(); watcher = null;
}
```

- [ ] **Step 16.4: Run + Commit**

```bash
npm test -- tests/integration/watcher-fs.test.ts
git add lib/watcher/ tests/integration/watcher-fs.test.ts
git commit -m "Add chokidar fs watcher with incremental jsonl tail"
```

---

## Task 17: `lib/obsidian/{vault,writer,reader}.ts`

**Files:**
- Create: `lib/obsidian/vault.ts`, `lib/obsidian/writer.ts`, `lib/obsidian/reader.ts`, `tests/integration/obsidian.test.ts`

- [ ] **Step 17.1: Failing test**

`tests/integration/obsidian.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { appendDailyNote } from "@/lib/obsidian/writer";

let vault: string;
beforeEach(() => { vault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-")); });
afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

describe("obsidian writer", () => {
  it("creates daily note and appends", async () => {
    await appendDailyNote(vault, { title: "T", summary: "S", recommendation: "R", project: "p", sessionShort: "abc", time: "12:00" });
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(vault, "Claude Sessions", `${today}.md`);
    expect(fs.existsSync(file)).toBe(true);
    const txt = fs.readFileSync(file, "utf8");
    expect(txt).toContain("**Title:** T");
    expect(txt).toContain("**Summary:** S");
  });
});
```

- [ ] **Step 17.2: vault.ts**

`lib/obsidian/vault.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";

export async function ensureVaultDirs(vault: string): Promise<void> {
  await fs.mkdir(path.join(vault, "Claude Sessions"), { recursive: true });
}
export function getVaultPath(): string | null {
  const v = process.env.OBSIDIAN_VAULT_PATH?.trim();
  return v && v.length > 0 ? v : null;
}
```

- [ ] **Step 17.3: writer.ts**

`lib/obsidian/writer.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { ensureVaultDirs } from "@/lib/obsidian/vault";

export type DailyEntry = {
  title?: string; summary?: string; recommendation?: string;
  project: string; sessionShort: string; time: string;
  watcherAlert?: string;
};

export async function appendDailyNote(vault: string, e: DailyEntry): Promise<void> {
  await ensureVaultDirs(vault);
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(vault, "Claude Sessions", `${date}.md`);
  try { await fs.access(file); } catch { await fs.writeFile(file, `# Claude Sessions ${date}\n\n`, "utf8"); }
  const release = await lockfile.lock(file, { retries: { retries: 5, minTimeout: 50 } });
  try {
    const block = [
      `## ${e.time} · ${e.project} · ${e.sessionShort}`,
      e.title           ? `**Title:** ${e.title}` : null,
      e.summary         ? `**Summary:** ${e.summary}` : null,
      e.recommendation  ? `**Recommendation:** ${e.recommendation}` : null,
      e.watcherAlert    ? `\n> Watcher alert: ${e.watcherAlert}` : null,
      ""
    ].filter(Boolean).join("\n") + "\n";
    await fs.appendFile(file, block, "utf8");
  } finally { await release(); }
}
```

- [ ] **Step 17.4: reader.ts**

`lib/obsidian/reader.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";

const FRONT_MATTER = /^---\s*\n([\s\S]*?)\n---/;

function parseFront(md: string): Record<string, string> {
  const m = md.match(FRONT_MATTER);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: any[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith(".md")) yield p;
  }
}

export async function refreshVaultIndex(vault: string): Promise<number> {
  const db = getDb();
  const upsert = db.prepare(`INSERT INTO obsidian_notes(path,project_id,session_id,mtime,excerpt) VALUES (?,?,?,?,?)
                             ON CONFLICT(path) DO UPDATE SET project_id=excluded.project_id,
                               session_id=excluded.session_id, mtime=excluded.mtime, excerpt=excluded.excerpt`);
  let n = 0;
  for await (const file of walk(vault)) {
    try {
      const stat = await fs.stat(file);
      const txt  = await fs.readFile(file, "utf8");
      const fm   = parseFront(txt);
      const projRow = fm.project ? db.prepare("SELECT id FROM projects WHERE name=?").get(fm.project) as any : null;
      upsert.run(path.relative(vault, file), projRow?.id ?? null, fm.session ?? null, stat.mtimeMs, txt.slice(0, 400));
      n++;
    } catch { }
  }
  return n;
}
```

- [ ] **Step 17.5: Run + Commit**

```bash
npm test -- tests/integration/obsidian.test.ts
git add lib/obsidian/ tests/integration/obsidian.test.ts
git commit -m "Add Obsidian vault writer + reader index"
```

---

## Task 18: `lib/singletons.ts` — bootstrap orchestrator

**Files:**
- Create: `lib/singletons.ts`

- [ ] **Step 18.1: Implement**

`lib/singletons.ts`:

```ts
import { getDb } from "@/lib/db";
import { scanAll } from "@/lib/indexer/scan";
import { startLivePolling } from "@/lib/indexer/live";
import { startFsWatcher } from "@/lib/watcher/fs";
import { reloadAllCronWatchers } from "@/lib/scheduler/cron";
import { startEventRouter } from "@/lib/scheduler/events";
import { bus } from "@/lib/bus";
import { recomputeProjectHealth, recomputeSessionHealth } from "@/lib/health/recompute";
import { debounce } from "@/lib/watcher/debounce";

declare global { var __dashboardBooted: boolean | undefined; }

export async function ensureBoot(): Promise<void> {
  if (globalThis.__dashboardBooted) return;
  globalThis.__dashboardBooted = true;
  getDb();
  await scanAll();
  startLivePolling(2000);
  await startFsWatcher();
  startEventRouter();
  reloadAllCronWatchers();

  const recomputeForSession = debounce((sid: string) => {
    try {
      recomputeSessionHealth(sid);
      const row = getDb().prepare("SELECT project_id FROM sessions WHERE id=?").get(sid) as any;
      if (row) recomputeProjectHealth(row.project_id);
    } catch {}
  }, 5000);
  bus.on("session:msg", (d: any) => recomputeForSession(d.sessionId));
  bus.on("session:new", (d: any) => recomputeForSession(d.sessionId));
}
```

- [ ] **Step 18.2: Commit**

```bash
git add lib/singletons.ts
git commit -m "Add bootstrap singleton"
```

---

## Task 19: API routes — projects + sessions

**Files:**
- Create: `app/api/projects/route.ts`, `app/api/projects/[id]/sessions/route.ts`,
  `app/api/sessions/[id]/route.ts`, `app/api/sessions/[id]/messages/route.ts`,
  `app/api/sessions/[id]/summarize/route.ts`

- [ ] **Step 19.1: projects list**

`app/api/projects/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export async function GET() {
  await ensureBoot();
  const rows = getDb().prepare(`
    SELECT p.*, ph.hp, ph.face,
           (SELECT MAX(last_msg_at) FROM sessions WHERE project_id=p.id) AS last_msg_at,
           (SELECT COUNT(*)         FROM sessions WHERE project_id=p.id) AS session_count
    FROM projects p LEFT JOIN pet_health ph ON ph.scope='project' AND ph.target_id=p.id
    ORDER BY last_msg_at DESC NULLS LAST
  `).all();
  return NextResponse.json(rows);
}
```

- [ ] **Step 19.2: project sessions**

`app/api/projects/[id]/sessions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const rows = getDb().prepare(`
    SELECT s.*, ph.hp, ph.face, sm.title, sm.summary
    FROM sessions s
    LEFT JOIN pet_health ph ON ph.scope='session' AND ph.target_id=s.id
    LEFT JOIN summaries sm  ON sm.session_id=s.id
    WHERE s.project_id=? ORDER BY s.last_msg_at DESC NULLS LAST
  `).all(params.id);
  return NextResponse.json(rows);
}
```

- [ ] **Step 19.3: session detail**

`app/api/sessions/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const row = getDb().prepare(`
    SELECT s.*, p.cwd, p.name AS project_name, sm.title, sm.summary, sm.recommendation,
           ph.hp, ph.face, ph.ai_advice
    FROM sessions s JOIN projects p ON p.id=s.project_id
    LEFT JOIN summaries sm ON sm.session_id=s.id
    LEFT JOIN pet_health ph ON ph.scope='session' AND ph.target_id=s.id
    WHERE s.id=?
  `).get(params.id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}
```

- [ ] **Step 19.4: messages + summarize**

`app/api/sessions/[id]/messages/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const url = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get("limit")  ?? "100", 10), 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);
  const rows = getDb().prepare(`
    SELECT role, content, ts FROM messages_fts WHERE session_id=? ORDER BY ts ASC LIMIT ? OFFSET ?
  `).all(params.id, limit, offset);
  return NextResponse.json(rows);
}
```

`app/api/sessions/[id]/summarize/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ensureBoot } from "@/lib/singletons";
import { summarizeSession } from "@/lib/ai/summarize";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  await summarizeSession(params.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 19.5: Manual smoke + Commit**

Run: `npm run dev`. In another shell: `curl http://127.0.0.1:3000/api/projects`. Expect JSON array.

```bash
git add app/api/projects/ app/api/sessions/
git commit -m "Add projects+sessions+summarize API routes"
```

---

## Task 20: API routes — watchers

**Files:**
- Create: `app/api/watchers/route.ts`, `app/api/watchers/[id]/route.ts`,
  `app/api/watchers/[id]/run/route.ts`, `app/api/watchers/[id]/runs/route.ts`

- [ ] **Step 20.1: List + create**

`app/api/watchers/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { registerCronWatcher } from "@/lib/scheduler/cron";

export async function GET() {
  await ensureBoot();
  return NextResponse.json(getDb().prepare("SELECT * FROM watchers ORDER BY id DESC").all());
}
export async function POST(req: Request) {
  await ensureBoot();
  const body = await req.json();
  const required = ["scope", "name", "prompt", "trigger_kind", "trigger_value"];
  for (const k of required) if (!body[k]) return NextResponse.json({ error: `missing ${k}` }, { status: 400 });
  const id = (getDb().prepare(`INSERT INTO watchers(scope,target_id,name,prompt,trigger_kind,trigger_value,enabled,notify_webhook,created_at)
                               VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(body.scope, body.target_id ?? null, body.name, body.prompt, body.trigger_kind, body.trigger_value,
         body.enabled === false ? 0 : 1, body.notify_webhook ?? null, Date.now()).lastInsertRowid) as number;
  const w = getDb().prepare("SELECT * FROM watchers WHERE id=?").get(id) as any;
  registerCronWatcher(w);
  return NextResponse.json(w);
}
```

- [ ] **Step 20.2: Patch + delete**

`app/api/watchers/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { registerCronWatcher, unregisterCron } from "@/lib/scheduler/cron";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const body = await req.json();
  const cols = ["name","prompt","trigger_kind","trigger_value","enabled","notify_webhook"].filter(c => c in body);
  if (cols.length === 0) return NextResponse.json({ error: "no fields" }, { status: 400 });
  const sql = `UPDATE watchers SET ${cols.map(c => `${c}=?`).join(",")} WHERE id=?`;
  getDb().prepare(sql).run(...cols.map(c => body[c]), params.id);
  const w = getDb().prepare("SELECT * FROM watchers WHERE id=?").get(params.id) as any;
  registerCronWatcher(w);
  return NextResponse.json(w);
}
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  unregisterCron(parseInt(params.id, 10));
  getDb().prepare("DELETE FROM watcher_runs WHERE watcher_id=?").run(params.id);
  getDb().prepare("DELETE FROM watchers WHERE id=?").run(params.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 20.3: Run-now + history**

`app/api/watchers/[id]/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ensureBoot } from "@/lib/singletons";
import { runWatcher } from "@/lib/scheduler/runner";
export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  await runWatcher(parseInt(params.id, 10));
  return NextResponse.json({ ok: true });
}
```

`app/api/watchers/[id]/runs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  return NextResponse.json(
    getDb().prepare("SELECT * FROM watcher_runs WHERE watcher_id=? ORDER BY started_at DESC LIMIT 100").all(params.id)
  );
}
```

- [ ] **Step 20.4: Commit**

```bash
git add app/api/watchers/
git commit -m "Add watchers CRUD + manual run + history APIs"
```

---

## Task 21: API routes — feed, search, settings, SSE

**Files:**
- Create: `app/api/feed/route.ts`, `app/api/search/route.ts`, `app/api/settings/route.ts`,
  `app/api/stream/route.ts`, `app/api/sessions/[id]/live/route.ts`

- [ ] **Step 21.1: feed**

`app/api/feed/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
export async function GET(req: Request) {
  await ensureBoot();
  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "100", 10), 500);
  return NextResponse.json(getDb().prepare("SELECT * FROM feed ORDER BY ts DESC LIMIT ?").all(limit));
}
```

- [ ] **Step 21.2: search**

`app/api/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export async function GET(req: Request) {
  await ensureBoot();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const projectId = url.searchParams.get("project_id");
  const role      = url.searchParams.get("role");
  const since     = url.searchParams.get("since");
  if (!q) return NextResponse.json([]);
  const conds: string[] = []; const args: any[] = [];
  conds.push("messages_fts MATCH ?"); args.push(q);
  if (role)  { conds.push("role = ?");  args.push(role); }
  if (since) { conds.push("ts >= ?");   args.push(parseInt(since, 10)); }
  const sql = `SELECT session_id, role, snippet(messages_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet, ts
               FROM messages_fts WHERE ${conds.join(" AND ")} ORDER BY ts DESC LIMIT 200`;
  let rows = getDb().prepare(sql).all(...args) as any[];
  if (projectId) {
    const ids = new Set((getDb().prepare("SELECT id FROM sessions WHERE project_id=?").all(projectId) as any[]).map(r => r.id));
    rows = rows.filter(r => ids.has(r.session_id));
  }
  return NextResponse.json(rows);
}
```

- [ ] **Step 21.3: settings**

`app/api/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

const ALLOWED = new Set(["health_weights","concurrency_caps","quota_threshold","project_hp_strategy","notify_webhook","obsidian_vault_path"]);

export async function GET() {
  await ensureBoot();
  const rows = getDb().prepare("SELECT key,value FROM settings").all() as any[];
  return NextResponse.json(Object.fromEntries(rows.map((r: any) => [r.key, r.value])));
}
export async function PATCH(req: Request) {
  await ensureBoot();
  const body = await req.json();
  const stmt = getDb().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED.has(k)) return NextResponse.json({ error: `unknown key ${k}` }, { status: 400 });
    stmt.run(k, String(v));
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 21.4: global SSE stream**

`app/api/stream/route.ts`:

```ts
import { ensureBoot } from "@/lib/singletons";
import { bus } from "@/lib/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureBoot();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: any) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const events: [string, (d: any) => void][] = [];
      const sub = (e: string) => { const fn = (d: any) => send(e, d); bus.on(e, fn); events.push([e, fn]); };
      ["session:new","session:msg","session:error","live:change","live:gone","watcher:done","watcher:alert","feed:new","health:change"].forEach(sub);
      const ka = setInterval(() => controller.enqueue(enc.encode(": ka\n\n")), 15000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ka);
        for (const [e, fn] of events) bus.off(e, fn);
        try { controller.close(); } catch {}
      });
    }
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "connection": "keep-alive" }
  });
}
```

- [ ] **Step 21.5: per-session SSE**

`app/api/sessions/[id]/live/route.ts`:

```ts
import { ensureBoot } from "@/lib/singletons";
import { bus } from "@/lib/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const fn = (d: any) => {
        if (d.sessionId === params.id) controller.enqueue(enc.encode(`event: session:msg\ndata: ${JSON.stringify(d)}\n\n`));
      };
      bus.on("session:msg", fn);
      const ka = setInterval(() => controller.enqueue(enc.encode(": ka\n\n")), 15000);
      req.signal.addEventListener("abort", () => { clearInterval(ka); bus.off("session:msg", fn); try { controller.close(); } catch {} });
    }
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "connection": "keep-alive" }
  });
}
```

- [ ] **Step 21.6: Commit**

```bash
git add app/api/feed/ app/api/search/ app/api/settings/ app/api/stream/ app/api/sessions/[id]/live/
git commit -m "Add feed, search, settings, SSE stream APIs"
```

---

## Task 22: Client SSE hook + PetCard + PetGrid

**Files:**
- Create: `components/useEventStream.ts`, `components/PetCard.tsx`, `components/PetGrid.tsx`

- [ ] **Step 22.1: useEventStream**

`components/useEventStream.ts`:

```ts
"use client";
import { useEffect, useRef } from "react";

export function useEventStream(handlers: Record<string, (d: any) => void>, path = "/api/stream") {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const es = new EventSource(path);
    const subs = Object.keys(ref.current);
    const fns = subs.map(name => {
      const fn = (e: MessageEvent) => { try { ref.current[name](JSON.parse(e.data)); } catch {} };
      es.addEventListener(name, fn as any);
      return [name, fn] as const;
    });
    return () => { for (const [n, f] of fns) es.removeEventListener(n, f as any); es.close(); };
  }, [path]);
}
```

- [ ] **Step 22.2: PetCard**

`components/PetCard.tsx`:

```tsx
"use client";
import Link from "next/link";

export type Pet = {
  scope: "project" | "session";
  id: string;
  name: string;
  hp: number | null;
  face: string | null;
  lastMsgAt: number | null;
  active: boolean;
  href: string;
  subline?: string;
};

function relTime(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function moodText(hp: number | null): string {
  if (hp == null) return "no data";
  if (hp >= 80) return "working hard";
  if (hp >= 50) return "on watch";
  if (hp >= 25) return "zzz";
  return "help me!";
}
function screenBg(hp: number | null): string {
  if (hp == null) return "bg-stone-300";
  if (hp >= 80) return "bg-green-300";
  if (hp >= 50) return "bg-emerald-200";
  if (hp >= 25) return "bg-stone-300";
  return "bg-red-300";
}
function barColor(hp: number | null): string {
  if (hp == null) return "bg-stone-400";
  if (hp >= 50) return "bg-green-500";
  if (hp >= 25) return "bg-stone-500";
  return "bg-red-500";
}

export function PetCard({ pet }: { pet: Pet }) {
  const hp = pet.hp ?? 0;
  return (
    <Link href={pet.href} className={`tama-card ${pet.active ? "tama-card-active" : ""}`}>
      <div className={`tama-screen ${screenBg(pet.hp)}`}>
        <div className="tama-face">{pet.face ?? "(?_?)"}</div>
        <div className="tama-mood">{moodText(pet.hp)}</div>
      </div>
      <div className="tama-name">{pet.name}</div>
      {pet.subline && <div className="text-[10px] font-mono text-stone-700">{pet.subline}</div>}
      <div className="tama-bar"><div className={`tama-bar-fill ${barColor(pet.hp)}`} style={{ width: `${hp}%` }} /></div>
      <div className="tama-stats"><span>HP {hp}</span><span>{relTime(pet.lastMsgAt)}</span></div>
    </Link>
  );
}
```

- [ ] **Step 22.3: PetGrid**

`components/PetGrid.tsx`:

```tsx
"use client";
import { PetCard, Pet } from "./PetCard";
import { useEventStream } from "./useEventStream";
import { useState } from "react";

export function PetGrid({ initial }: { initial: Pet[] }) {
  const [pets, setPets] = useState(initial);
  useEventStream({
    "health:change": (d) => setPets(p => p.map(x => x.id === d.targetId && x.scope === d.scope ? { ...x, hp: d.hp } : x)),
    "live:change":   () => { fetch("/api/projects").then(r => r.json()).then(rows => setPets(rows.map(rowToPet))); }
  });
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {pets.map(p => <PetCard key={`${p.scope}:${p.id}`} pet={p} />)}
    </div>
  );
}

export function rowToPet(r: any): Pet {
  return {
    scope: "project",
    id: r.id, name: r.name,
    hp: r.hp ?? null, face: r.face ?? "(?_?)",
    lastMsgAt: r.last_msg_at ?? null,
    active: false,
    href: `/p/${r.id}`,
    subline: `${r.session_count ?? 0} sessions`
  };
}
```

- [ ] **Step 22.4: Commit**

```bash
git add components/useEventStream.ts components/PetCard.tsx components/PetGrid.tsx
git commit -m "Add SSE hook + PetCard + PetGrid components"
```

---

## Task 23: UI — Pet Zoo home (`app/page.tsx`)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 23.1: Replace home**

```tsx
import { headers } from "next/headers";
import { PetGrid, rowToPet } from "@/components/PetGrid";

async function fetchProjects() {
  const h = headers();
  const host = h.get("host");
  const res = await fetch(`http://${host}/api/projects`, { cache: "no-store" });
  return res.json();
}

export default async function Home() {
  const rows = await fetchProjects();
  const pets = rows.map(rowToPet);
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Pet Zoo</h1>
        <nav className="flex gap-3 text-sm">
          <a href="/watchers" className="underline">Watchers</a>
          <a href="/feed" className="underline">Feed</a>
          <a href="/search" className="underline">Search</a>
          <a href="/settings" className="underline">Settings</a>
        </nav>
      </header>
      <PetGrid initial={pets} />
    </main>
  );
}
```

- [ ] **Step 23.2: Manual smoke + Commit**

Run: `npm run dev`. Open `http://127.0.0.1:3000/`. Expect grid of project pets sized to your real `~/.claude/projects/` data.

```bash
git add app/page.tsx
git commit -m "Add pet zoo home page"
```

---

## Task 24: UI — Project detail

**Files:**
- Create: `app/p/[projectId]/page.tsx`

- [ ] **Step 24.1: Implement**

```tsx
import { headers } from "next/headers";
import { PetCard, Pet } from "@/components/PetCard";
import Link from "next/link";

async function fetchSessions(id: string) {
  const h = headers();
  const res = await fetch(`http://${h.get("host")}/api/projects/${id}/sessions`, { cache: "no-store" });
  return res.json();
}

export default async function ProjectPage({ params }: { params: { projectId: string } }) {
  const rows = await fetchSessions(params.projectId);
  const pets: Pet[] = rows.map((r: any) => ({
    scope: "session",
    id: r.id,
    name: r.title ?? r.id.slice(0, 8),
    hp: r.hp ?? null,
    face: r.face ?? "(?_?)",
    lastMsgAt: r.last_msg_at ?? null,
    active: r.status === "active",
    href: `/s/${r.id}`,
    subline: `${r.msg_count ?? 0} turns · ${r.model ?? "?"}`
  }));
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <Link href="/" className="text-sm underline">← back to zoo</Link>
      <h1 className="text-2xl font-bold mt-2 mb-4">Project: {params.projectId}</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {pets.map(p => <PetCard key={p.id} pet={p} />)}
      </div>
    </main>
  );
}
```

- [ ] **Step 24.2: Commit**

```bash
git add app/p/
git commit -m "Add project detail page with child session pets"
```

---

## Task 25: UI — Session detail with live tail panel

**Files:**
- Create: `components/MessageList.tsx`, `components/LiveTailPanel.tsx`, `app/s/[sessionId]/page.tsx`

- [ ] **Step 25.1: MessageList**

`components/MessageList.tsx`:

```tsx
"use client";
type Msg = { role: string; content: string; ts: number };
export function MessageList({ messages }: { messages: Msg[] }) {
  return (
    <div className="border-2 border-stone-900 rounded-md bg-white p-3 max-h-[60vh] overflow-y-auto font-mono text-xs space-y-2">
      {messages.map((m, i) => (
        <div key={i} className="border-b border-stone-200 pb-1">
          <span className="font-bold">{m.role}</span>
          <span className="text-stone-500"> · {new Date(m.ts).toLocaleString()}</span>
          <pre className="whitespace-pre-wrap mt-1">{m.content}</pre>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 25.2: LiveTailPanel**

`components/LiveTailPanel.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

export function LiveTailPanel({ sessionId }: { sessionId: string }) {
  const [msgs, setMsgs] = useState<{ role: string; content: string; ts: number }[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${sessionId}/live`);
    const onMsg = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setMsgs(curr => [...curr, { role: d.role, content: d.content, ts: d.ts }].slice(-50));
        requestAnimationFrame(() => ref.current?.scrollTo({ top: ref.current.scrollHeight }));
      } catch {}
    };
    es.addEventListener("session:msg", onMsg as any);
    return () => { es.removeEventListener("session:msg", onMsg as any); es.close(); };
  }, [sessionId]);
  return (
    <div className="border-2 border-stone-900 rounded-md bg-amber-50 p-3 h-[60vh] overflow-y-auto font-mono text-xs" ref={ref}>
      <div className="text-stone-600 mb-2">Live tail (last 50 messages while session is active)</div>
      {msgs.map((m, i) => (
        <div key={i} className="border-b border-stone-200 py-1">
          <span className="font-bold">{m.role}</span>
          <pre className="whitespace-pre-wrap">{m.content}</pre>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 25.3: Session page**

`app/s/[sessionId]/page.tsx`:

```tsx
import { headers } from "next/headers";
import Link from "next/link";
import { MessageList } from "@/components/MessageList";
import { LiveTailPanel } from "@/components/LiveTailPanel";

async function fetchSession(id: string) {
  const h = headers().get("host");
  const [meta, msgs] = await Promise.all([
    fetch(`http://${h}/api/sessions/${id}`,          { cache: "no-store" }).then(r => r.json()),
    fetch(`http://${h}/api/sessions/${id}/messages`, { cache: "no-store" }).then(r => r.json())
  ]);
  return { meta, msgs };
}

export default async function SessionPage({ params }: { params: { sessionId: string } }) {
  const { meta, msgs } = await fetchSession(params.sessionId);
  if (meta?.error) return <main className="p-6">not found</main>;
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <Link href={`/p/${meta.project_id}`} className="text-sm underline">← project</Link>
      <h1 className="text-2xl font-bold mt-2">{meta.title ?? params.sessionId}</h1>
      <div className="text-sm text-stone-600 mb-4">{meta.project_name} · {meta.model ?? "?"} · HP {meta.hp ?? "—"} · {meta.face ?? ""}</div>

      {meta.summary && (
        <section className="bg-amber-100 border-2 border-stone-900 rounded-md p-3 mb-4">
          <div className="font-bold">Summary</div>
          <p>{meta.summary}</p>
          {meta.recommendation && <p className="mt-2"><strong>Recommendation:</strong> {meta.recommendation}</p>}
          {meta.ai_advice      && <p className="mt-2"><strong>Advice:</strong> {meta.ai_advice}</p>}
        </section>
      )}

      <form action={`/api/sessions/${params.sessionId}/summarize`} method="post" className="mb-4">
        <button className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200">Regenerate summary</button>
      </form>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h2 className="font-bold mb-2">Messages</h2>
          <MessageList messages={msgs} />
        </div>
        <div>
          <h2 className="font-bold mb-2">Live tail</h2>
          <LiveTailPanel sessionId={params.sessionId} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 25.4: Commit**

```bash
git add components/MessageList.tsx components/LiveTailPanel.tsx app/s/
git commit -m "Add session detail page with live tail panel + regen summary"
```

---

## Task 26: UI — Watcher manager (form + list)

**Files:**
- Create: `components/WatcherForm.tsx`, `components/WatcherList.tsx`, `app/watchers/page.tsx`

- [ ] **Step 26.1: WatcherForm**

`components/WatcherForm.tsx`:

```tsx
"use client";
import { useState } from "react";

const PRESETS: Record<string, string> = {
  "Summarize new commits": "Look at git log since the last watcher run; summarize changes in 2 sentences. Reply ok unless something is broken.",
  "Check for failed tests": "Run the project's test command and report any failures. Reply alert if any test fails.",
  "Flag stuck tasks":       "Review ~/.claude/todos/ and ~/.claude/plans/. Reply alert if any item has been in_progress > 24h with no movement."
};

export function WatcherForm({ onCreated }: { onCreated: (w: any) => void }) {
  const [scope, setScope]                 = useState("project");
  const [targetId, setTargetId]           = useState("");
  const [name, setName]                   = useState("");
  const [prompt, setPrompt]               = useState("");
  const [trigger_kind, setKind]           = useState<"cron" | "event">("cron");
  const [trigger_value, setVal]           = useState("0 */30 * * *");
  const [enabled, setEnabled]             = useState(true);
  const [notify_webhook, setHook]         = useState("");

  return (
    <form onSubmit={async e => {
      e.preventDefault();
      const r = await fetch("/api/watchers", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, target_id: targetId || null, name, prompt, trigger_kind, trigger_value, enabled, notify_webhook: notify_webhook || null })
      });
      onCreated(await r.json());
    }} className="grid gap-2 border-2 border-stone-900 rounded-md p-3 bg-amber-50">
      <div className="grid grid-cols-3 gap-2">
        <select value={scope} onChange={e => setScope(e.target.value)} className="border p-1">
          <option value="project">project</option>
          <option value="session">session</option>
          <option value="global">global</option>
        </select>
        <input value={targetId} onChange={e => setTargetId(e.target.value)} placeholder="target id (project/session)" className="border p-1 col-span-2" />
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="watcher name" className="border p-1" required />
      <select onChange={e => { if (PRESETS[e.target.value]) setPrompt(PRESETS[e.target.value]); }} className="border p-1">
        <option value="">— preset —</option>
        {Object.keys(PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="prompt (free text)" className="border p-1 min-h-[80px]" required />
      <div className="grid grid-cols-2 gap-2">
        <select value={trigger_kind} onChange={e => setKind(e.target.value as any)} className="border p-1">
          <option value="cron">cron</option>
          <option value="event">event</option>
        </select>
        {trigger_kind === "cron" ? (
          <select value={trigger_value} onChange={e => setVal(e.target.value)} className="border p-1">
            <option value="*/15 * * * *">every 15m</option>
            <option value="*/30 * * * *">every 30m</option>
            <option value="0 * * * *">every 1h</option>
            <option value="0 */6 * * *">every 6h</option>
            <option value="0 9 * * *">daily 09:00</option>
          </select>
        ) : (
          <select value={trigger_value} onChange={e => setVal(e.target.value)} className="border p-1">
            <option value="on:session_new">on:session_new</option>
            <option value="on:session_msg">on:session_msg</option>
            <option value="on:error">on:error</option>
            <option value="on:plan_change">on:plan_change</option>
            <option value="on:todo_change">on:todo_change</option>
          </select>
        )}
      </div>
      <input value={notify_webhook} onChange={e => setHook(e.target.value)} placeholder="webhook URL (optional)" className="border p-1" />
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />enabled</label>
      <button className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200">Create watcher</button>
    </form>
  );
}
```

- [ ] **Step 26.2: WatcherList**

`components/WatcherList.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

export function WatcherList() {
  const [items, setItems] = useState<any[]>([]);
  const refresh = () => fetch("/api/watchers").then(r => r.json()).then(setItems);
  useEffect(() => { refresh(); }, []);
  async function runNow(id: number) { await fetch(`/api/watchers/${id}/run`, { method: "POST" }); refresh(); }
  async function toggle(w: any)     {
    await fetch(`/api/watchers/${w.id}`, { method: "PATCH", headers: {"content-type":"application/json"},
      body: JSON.stringify({ enabled: w.enabled ? 0 : 1 }) });
    refresh();
  }
  async function remove(id: number) { if (!confirm("delete watcher?")) return; await fetch(`/api/watchers/${id}`, { method: "DELETE" }); refresh(); }
  return (
    <ul className="grid gap-2">
      {items.map(w => (
        <li key={w.id} className="border-2 border-stone-900 rounded-md p-3 bg-white flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${w.enabled ? "bg-green-500" : "bg-stone-400"}`} />
          <div className="flex-1">
            <div className="font-bold">{w.name} <span className="text-stone-500 text-xs">[{w.scope}{w.target_id ? `:${w.target_id}` : ""}]</span></div>
            <div className="text-xs text-stone-600">{w.trigger_kind} · {w.trigger_value}</div>
            <div className="text-xs">{w.prompt}</div>
          </div>
          <button onClick={() => runNow(w.id)} className="border px-2 py-1 text-xs">Run</button>
          <button onClick={() => toggle(w)}    className="border px-2 py-1 text-xs">{w.enabled ? "Disable" : "Enable"}</button>
          <button onClick={() => remove(w.id)} className="border px-2 py-1 text-xs">Delete</button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 26.3: Watchers page**

`app/watchers/page.tsx`:

```tsx
"use client";
import { WatcherForm } from "@/components/WatcherForm";
import { WatcherList } from "@/components/WatcherList";
import { useState } from "react";

export default function WatchersPage() {
  const [tick, setTick] = useState(0);
  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Watchers</h1>
      <WatcherForm onCreated={() => setTick(t => t + 1)} />
      <div className="my-6"><WatcherList key={tick} /></div>
    </main>
  );
}
```

- [ ] **Step 26.4: Commit**

```bash
git add components/WatcherForm.tsx components/WatcherList.tsx app/watchers/
git commit -m "Add watcher manager UI"
```

---

## Task 27: UI — Feed page (live)

**Files:**
- Create: `components/FeedList.tsx`, `app/feed/page.tsx`

- [ ] **Step 27.1: FeedList**

`components/FeedList.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useEventStream } from "./useEventStream";

type Item = { id: number; ts: number; kind: string; project_id: string | null; session_id: string | null; payload: string };

export function FeedList() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { fetch("/api/feed").then(r => r.json()).then(setItems); }, []);
  useEventStream({ "feed:new": () => fetch("/api/feed").then(r => r.json()).then(setItems) });
  return (
    <ul className="space-y-2">
      {items.map(i => {
        let p: any = {}; try { p = JSON.parse(i.payload); } catch {}
        return (
          <li key={i.id} className="border-2 border-stone-900 rounded-md p-3 bg-white">
            <div className="text-xs text-stone-500">{new Date(i.ts).toLocaleString()} · {i.kind}</div>
            <div className="font-bold">{p.name ?? p.title ?? i.kind}</div>
            {p.message        && <div className="text-sm">{p.message}</div>}
            {p.recommendation && <div className="text-sm text-stone-700">→ {p.recommendation}</div>}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 27.2: Feed page**

`app/feed/page.tsx`:

```tsx
import { FeedList } from "@/components/FeedList";
export default function FeedPage() {
  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Activity Feed</h1>
      <FeedList />
    </main>
  );
}
```

- [ ] **Step 27.3: Commit**

```bash
git add components/FeedList.tsx app/feed/
git commit -m "Add activity feed page (live)"
```

---

## Task 28: UI — Search page

**Files:**
- Create: `components/SearchBar.tsx`, `app/search/page.tsx`

- [ ] **Step 28.1: SearchBar**

`components/SearchBar.tsx`:

```tsx
"use client";
import { useState } from "react";

type Hit = { session_id: string; role: string; snippet: string; ts: number };

export function SearchBar() {
  const [q, setQ]       = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    setHits(await r.json());
  }
  return (
    <div>
      <form onSubmit={go} className="flex gap-2 mb-4">
        <input className="border p-2 flex-1" value={q} onChange={e => setQ(e.target.value)} placeholder="search messages…" />
        <button className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200">Go</button>
      </form>
      <ul className="space-y-2">
        {hits.map((h, i) => (
          <li key={i} className="border-2 border-stone-900 rounded-md p-3 bg-white">
            <div className="text-xs text-stone-500">{new Date(h.ts).toLocaleString()} · {h.role}</div>
            <a className="underline text-sm" href={`/s/${h.session_id}`}>session {h.session_id.slice(0, 8)}</a>
            <div className="font-mono text-xs mt-1" dangerouslySetInnerHTML={{ __html: h.snippet }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 28.2: Search page**

`app/search/page.tsx`:

```tsx
import { SearchBar } from "@/components/SearchBar";
export default function SearchPage() {
  return <main className="p-6 max-w-3xl mx-auto"><h1 className="text-2xl font-bold mb-4">Search</h1><SearchBar /></main>;
}
```

- [ ] **Step 28.3: Commit**

```bash
git add components/SearchBar.tsx app/search/
git commit -m "Add search page with FTS snippets"
```

---

## Task 29: UI — Settings page

**Files:**
- Create: `components/SettingsForm.tsx`, `app/settings/page.tsx`

- [ ] **Step 29.1: SettingsForm**

`components/SettingsForm.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

export function SettingsForm() {
  const [s, setS] = useState<Record<string, string>>({});
  useEffect(() => { fetch("/api/settings").then(r => r.json()).then(setS); }, []);
  function set(k: string, v: string) { setS(curr => ({ ...curr, [k]: v })); }
  async function save() {
    const r = await fetch("/api/settings", {
      method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify(s)
    });
    alert(r.ok ? "saved" : `error: ${await r.text()}`);
  }
  return (
    <div className="grid gap-3 max-w-xl">
      <label className="grid">
        <span className="text-sm font-bold">Obsidian vault path</span>
        <input className="border p-2" value={s.obsidian_vault_path ?? ""} onChange={e => set("obsidian_vault_path", e.target.value)} placeholder="C:\Users\me\Obsidian" />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Notify webhook (Discord/Slack URL)</span>
        <input className="border p-2" value={s.notify_webhook ?? ""} onChange={e => set("notify_webhook", e.target.value)} />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Health weights (JSON)</span>
        <input className="border p-2 font-mono text-xs" value={s.health_weights ?? ""} onChange={e => set("health_weights", e.target.value)} />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Concurrency caps (JSON)</span>
        <input className="border p-2 font-mono text-xs" value={s.concurrency_caps ?? ""} onChange={e => set("concurrency_caps", e.target.value)} />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Quota threshold (tokens)</span>
        <input className="border p-2" value={s.quota_threshold ?? ""} onChange={e => set("quota_threshold", e.target.value)} />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Project HP strategy</span>
        <select className="border p-2" value={s.project_hp_strategy ?? "max"} onChange={e => set("project_hp_strategy", e.target.value)}>
          <option value="max">max</option>
          <option value="avg">avg</option>
        </select>
      </label>
      <button onClick={save} className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200">Save</button>
    </div>
  );
}
```

- [ ] **Step 29.2: Settings page**

`app/settings/page.tsx`:

```tsx
import { SettingsForm } from "@/components/SettingsForm";
export default function SettingsPage() {
  return <main className="p-6 max-w-3xl mx-auto"><h1 className="text-2xl font-bold mb-4">Settings</h1><SettingsForm /></main>;
}
```

- [ ] **Step 29.3: Commit**

```bash
git add components/SettingsForm.tsx app/settings/
git commit -m "Add settings page (vault, webhook, weights, caps, quota)"
```

---

## Task 30: Boot check for `claude` binary + banner

**Files:**
- Create: `app/api/health/route.ts`, `components/BootBanner.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 30.1: Health API**

`app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
export async function GET() {
  const bin = process.env.CLAUDE_BIN ?? "claude";
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return NextResponse.json({ claude_ok: r.status === 0, claude_version: (r.stdout || "").trim() || null });
}
```

- [ ] **Step 30.2: Banner**

`components/BootBanner.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

export function BootBanner() {
  const [s, setS] = useState<{ claude_ok: boolean } | null>(null);
  useEffect(() => { fetch("/api/health").then(r => r.json()).then(setS); }, []);
  if (!s || s.claude_ok) return null;
  return (
    <div className="bg-red-200 border-b-4 border-red-700 text-red-900 px-4 py-2 text-sm">
      ⚠ <strong>claude</strong> CLI not on PATH. Watcher runs and summaries are disabled until you install Claude Code or set <code>CLAUDE_BIN</code>.
    </div>
  );
}
```

- [ ] **Step 30.3: Mount in layout**

Modify `app/layout.tsx`:

```tsx
import "./globals.css";
import { BootBanner } from "@/components/BootBanner";
export const metadata = { title: "Claude Session Dashboard" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="bg-amber-50 text-stone-900"><BootBanner />{children}</body></html>;
}
```

- [ ] **Step 30.4: Commit**

```bash
git add app/api/health/ components/BootBanner.tsx app/layout.tsx
git commit -m "Add claude CLI presence check + boot banner"
```

---

## Task 31: Playwright smoke

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`

- [ ] **Step 31.1: Playwright config**

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: true, timeout: 60_000 }
});
```

- [ ] **Step 31.2: Smoke spec**

`tests/e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("home renders pet zoo header", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pet Zoo" })).toBeVisible();
});
test("watchers page renders form", async ({ page }) => {
  await page.goto("/watchers");
  await expect(page.getByText("Watchers")).toBeVisible();
});
```

- [ ] **Step 31.3: Install browsers + run**

```bash
npx playwright install chromium
npm run test:e2e
```

Expected: 2 passed.

- [ ] **Step 31.4: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "Add Playwright smoke tests"
```

---

## Task 32: README quickstart + .env.example

**Files:**
- Create: `README.md`, `.env.example`

- [ ] **Step 32.1: .env.example**

```
# Override paths if not default
# CLAUDE_HOME=C:\Users\you\.claude
# CLAUDE_BIN=claude
# OBSIDIAN_VAULT_PATH=C:\Users\you\Obsidian
# DASHBOARD_DB=D:\dashboard\data\dashboard.db
```

- [ ] **Step 32.2: README**

`README.md`:

```md
# Claude Session Dashboard

Local Tamagotchi-style dashboard for every Claude Code session — watchers, AI summaries, live tail, Obsidian.

## Quickstart

1. `npm install`
2. (optional) copy `.env.example` to `.env.local` and set `OBSIDIAN_VAULT_PATH`.
3. `npm run dev`
4. Open `http://127.0.0.1:3000`

## Requirements

- Node 18+
- `claude` CLI on PATH (or set `CLAUDE_BIN`)
- Existing `~/.claude/` directory from prior Claude Code use

## Tests

- Unit/integration: `npm test`
- E2E smoke: `npm run test:e2e`

## Security

Binds to `127.0.0.1` only. No auth — single-user local app.
```

- [ ] **Step 32.3: Commit**

```bash
git add README.md .env.example
git commit -m "Add README quickstart and .env.example"
```

---

## Self-Review Checklist (run before handoff)

- [ ] Every spec section maps to one or more tasks (architecture → T1/T2; data model → T5; components → T4–T18; API → T19–T21; UI → T22–T29; Obsidian → T17/T13/T14; webhooks → T15; live-tail → T9/T16/T21/T25; health → T10/T11; security/banner → T30; testing → T3/T31).
- [ ] No "TBD", "TODO", or "implement later" strings in any task.
- [ ] Type names consistent: `ParseResult`, `RunResult`, `Pet`, `HealthResult` referenced where defined.
- [ ] Every test has actual test code shown.
- [ ] Every commit step lists exact files added.
- [ ] No task references a function that no earlier task introduced.

## v1 Success Criteria Coverage

| Spec criterion | Implementing tasks |
|---|---|
| `npm run dev` shows pet zoo with real projects | T1, T8, T22, T23 |
| Active session pulses + side panel streams | T9, T16, T21, T25 |
| Cron watcher runs successfully | T14, T20, T26 |
| Manual watcher run < 30s | T20, T26 |
| Webhook POST on alert | T14, T15 |
| AI summary + recommendation appear | T13, T19, T25 |
| Obsidian vault gets daily-note appends | T17, T13, T14, T29 |
