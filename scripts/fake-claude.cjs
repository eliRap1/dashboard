#!/usr/bin/env node
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
