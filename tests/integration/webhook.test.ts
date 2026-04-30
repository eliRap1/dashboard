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
