#!/usr/bin/env node
const env = process.env.FAKE_CLAUDE_ENV || "ok";
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => { prompt += c; });
process.stdin.on("end", () => {
  if (env === "alert") {
    process.stdout.write(JSON.stringify({ status: "alert", message: "pretend bad", recommendation: "fix" }));
  } else if (env === "timeout") {
    setInterval(() => {}, 1000);
  } else {
    process.stdout.write(JSON.stringify({ status: "ok", title: "stub", summary: "stub summary", recommendation: "none", message: prompt.slice(0, 40) }));
  }
});
