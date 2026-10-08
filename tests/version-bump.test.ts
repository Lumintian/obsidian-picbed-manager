import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const project = process.cwd();

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "picbed-release-test-"));
  roots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "origin.git");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  copyFileSync(join(project, "scripts/version-bump.mjs"), join(repo, "scripts/version-bump.mjs"));
  const { scripts } = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({
    name: "release-test", version: "0.2.0", private: true,
    scripts: Object.fromEntries(["bump", "preversion", "version", "postversion"].map(key => [key, scripts[key]])),
  }, null, 2)}\n`);
  writeFileSync(join(repo, "manifest.json"), `${JSON.stringify({ version: "0.2.0", minAppVersion: "1.5.0" }, null, 2)}\n`);
  writeFileSync(join(repo, "versions.json"), '{"0.2.0":"1.5.0"}\n');
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release-test@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("add", ".");
  git("commit", "-m", "Initial fixture");
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "main");
  const pnpm = (...args: string[]) => spawnSync("pnpm", args, { cwd: repo, encoding: "utf8", timeout: 20_000 });
  const json = (file: string) => JSON.parse(readFileSync(join(repo, file), "utf8"));
  return { repo, remote, git, pnpm, json };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("release commands (isolated local Git remotes)", () => {
  for (const command of ["bump", "version"]) {
    it.each([
      ["patch", "0.2.1"],
      ["minor", "0.3.0"],
      ["major", "1.0.0"],
      ["0.4.2", "0.4.2"],
    ])(`pnpm ${command} %s synchronizes, commits, tags and pushes`, (input, version) => {
      const f = fixture();
      const result = f.pnpm(command, input);
      expect(result.stderr + result.stdout).toContain(`Published ${version}`);
      expect(result.status).toBe(0);
      expect(f.json("package.json").version).toBe(version);
      expect(f.json("manifest.json").version).toBe(version);
      expect(f.json("versions.json")).toEqual({ "0.2.0": "1.5.0", [version]: "1.5.0" });
      expect(f.git("status", "--porcelain")).toBe("");
      expect(f.git("tag", "--list")).toBe(version);
      expect(f.git("rev-list", "--count", "HEAD")).toBe("2");
      const remoteGit = (...args: string[]) => execFileSync("git", ["--git-dir", f.remote, ...args], { encoding: "utf8" }).trim();
      expect(remoteGit("rev-parse", "refs/heads/main")).toBe(f.git("rev-parse", "HEAD"));
      expect(remoteGit("rev-parse", `${version}^{commit}`)).toBe(f.git("rev-parse", "HEAD"));
      for (const file of ["package.json", "manifest.json", "versions.json"]) {
        expect(remoteGit("show", `${version}:${file}`)).toBe(readFileSync(join(f.repo, file), "utf8").trim());
      }
    }, 30_000);
  }

  it.each(["bump", "version"])("pnpm %s refuses an untracked file without publishing", command => {
    const f = fixture();
    writeFileSync(join(f.repo, "untracked.txt"), "keep me");
    const result = f.pnpm(command, "patch");
    expect(result.status).not.toBe(0);
    expect(f.json("package.json").version).toBe("0.2.0");
    expect(f.git("ls-remote", "--tags", "origin")).toBe("");
  }, 30_000);

  it("rejects non-increasing and malformed versions without remote tags", () => {
    const f = fixture();
    expect(f.pnpm("bump", "01.2.3").status).not.toBe(0);
    expect(f.pnpm("version", "0.1.0").status).not.toBe(0);
    expect(f.json("manifest.json").version).toBe("0.2.0");
    expect(f.git("ls-remote", "--tags", "origin")).toBe("");
  }, 30_000);

  it("does not publish when native Git commit/tag creation is disabled", () => {
    const f = fixture();
    expect(f.pnpm("version", "patch", "--no-git-tag-version").status).not.toBe(0);
    expect(f.git("ls-remote", "--tags", "origin")).toBe("");
  }, 30_000);

  it("keeps a failed push local and prints a retry command", () => {
    const f = fixture();
    writeFileSync(join(f.remote, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = f.pnpm("bump", "patch");
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("git push --atomic origin HEAD:refs/heads/main refs/tags/0.2.1");
    expect(f.git("tag", "--list")).toBe("0.2.1");
    expect(f.git("ls-remote", "--tags", "origin")).toBe("");
    expect(f.git("rev-parse", "origin/main")).not.toBe(f.git("rev-parse", "HEAD"));
  }, 30_000);

  it("ordinary commits do not create release tags; workflow listens only to tags", () => {
    const f = fixture();
    writeFileSync(join(f.repo, "note.txt"), "ordinary change");
    f.git("add", "note.txt");
    f.git("commit", "-m", "Ordinary change");
    f.git("push", "origin", "main");
    expect(f.git("ls-remote", "--tags", "origin")).toBe("");
    for (const path of [".github/workflows/release.yml"]) {
      const workflow = readFileSync(join(project, path), "utf8");
      expect(workflow).toContain("on:\n  push:\n    tags:\n");
      expect(workflow).not.toMatch(/branches:|pull_request:|workflow_dispatch:/);
    }
  });
});
