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
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    const s = JSON.stringify(content);
    // Treat trivial objects/empty as no-content so callers can fall through to other shapes.
    return s === "{}" || s === "[]" || s === '""' ? "" : s;
  }
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
  // Skip pure-metadata shapes (no content, just session-level state)
  const META_TYPES = new Set(["last-prompt", "permission-mode", "summary", "compact-marker"]);
  let bytes = fromOffset;
  for await (const raw of rl) {
    bytes += Buffer.byteLength(raw, "utf8") + 1;
    const line = raw.trim();
    if (!line) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (typeof obj.type === "string" && META_TYPES.has(obj.type)) continue;

    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();

    // Pull content from any of the known shapes; pick the first non-empty.
    let role: string = obj.message?.role ?? obj.type ?? "unknown";
    let content = flattenContent(obj.message?.content);
    if (!content && obj.attachment) {
      const a = obj.attachment;
      role = a.hookName ? `hook:${a.hookName}` : a.type ? `attachment:${a.type}` : "attachment";
      content = typeof a.content === "string" ? a.content : JSON.stringify(a.content ?? "");
    }
    if (!content && typeof obj.content === "string") content = obj.content;
    if (!content && typeof obj.text === "string")    content = obj.text;
    if (!content && obj.toolUseResult)               content = `[result:${typeof obj.toolUseResult === "string" ? obj.toolUseResult : JSON.stringify(obj.toolUseResult)}]`;
    if (!content) continue; // skip empty rows entirely

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
