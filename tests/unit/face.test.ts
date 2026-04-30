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
