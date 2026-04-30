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
