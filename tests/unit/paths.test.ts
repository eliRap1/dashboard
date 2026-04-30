import { describe, expect, it } from "vitest";
import { encodeCwdToProjectsDir, projectsDir, sessionsDir, claudeHome } from "@/lib/paths";

describe("paths", () => {
  it("claudeHome resolves under user home", () => {
    expect(claudeHome()).toMatch(/[\\/]\.claude$/);
  });
  it("projectsDir under claudeHome", () => {
    expect(projectsDir()).toMatch(/[\\/]\.claude[\\/]projects$/);
  });
  it("sessionsDir under claudeHome", () => {
    expect(sessionsDir()).toMatch(/[\\/]\.claude[\\/]sessions$/);
  });
  it("encodes Windows cwd D:\\dashboard to D--dashboard", () => {
    expect(encodeCwdToProjectsDir("D:\\dashboard")).toBe("D--dashboard");
  });
  it("encodes posix cwd /Users/eli/foo bar to dash form", () => {
    expect(encodeCwdToProjectsDir("/Users/eli/foo bar")).toBe("-Users-eli-foo-bar");
  });
});
