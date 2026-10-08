// Shared release lifecycle for pnpm bump and pnpm version.
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const files = ["package.json", "manifest.json", "versions.json"];

try {
  const mode = process.argv[2];
  if (mode === "--preversion") {
    requireCleanTree();
    branch();
    git("remote", "get-url", "origin");
    git("ls-remote", "origin");
    const pkg = await readJson("package.json");
    const manifest = await readJson("manifest.json");
    if (pkg.version !== manifest.version) {
      throw new Error("package.json and manifest.json versions must match before releasing.");
    }
  } else if (mode === "--sync") {
    const pkg = await readJson("package.json");
    const manifest = await readJson("manifest.json");
    const versions = await readJson("versions.json");
    validateVersion(pkg.version);
    if (compareVersions(pkg.version, manifest.version) <= 0) {
      throw new Error(`Version ${pkg.version} must be newer than ${manifest.version}.`);
    }
    if (git("tag", "--list", pkg.version, `v${pkg.version}`)) {
      throw new Error(`A local tag already exists for ${pkg.version}.`);
    }
    if (git("ls-remote", "--tags", "origin", `refs/tags/${pkg.version}`, `refs/tags/v${pkg.version}`)) {
      throw new Error(`A remote tag already exists for ${pkg.version}.`);
    }
    manifest.version = pkg.version;
    versions[pkg.version] = manifest.minAppVersion;
    await writeJson("manifest.json", manifest);
    await writeJson("versions.json", versions);
    git("add", "--", ...files);
  } else if (mode === "--publish") {
    requireCleanTree();
    const { version } = await readJson("package.json");
    validateVersion(version);
    // Reject --no-git-tag-version: never publish a tag on the previous commit.
    for (const file of files) {
      if (git("show", `HEAD:${file}`) !== (await readFile(file, "utf8")).trim()) {
        throw new Error("Version files must be committed before publishing. Do not use --no-git-tag-version.");
      }
    }
    const head = git("rev-parse", "HEAD");
    if (!git("tag", "--list", version)) {
      git("tag", "-a", version, "-m", `Release ${version}`);
    }
    if (git("rev-parse", `${version}^{commit}`) !== head) {
      throw new Error(`Tag ${version} does not point to the release commit.`);
    }
    // pnpm version defaults to a v-prefixed tag; Obsidian requires a bare version.
    if (git("tag", "--list", `v${version}`) && git("rev-parse", `v${version}^{commit}`) === head) {
      git("tag", "-d", `v${version}`);
    }
    const ref = `HEAD:refs/heads/${branch()}`;
    try {
      git("push", "--atomic", "origin", ref, `refs/tags/${version}`);
    } catch {
      throw new Error(`Release ${version} exists locally, but push failed. Fix the remote problem, then retry: git push --atomic origin ${ref} refs/tags/${version}`);
    }
    console.log(`Published ${version} to origin. The version tag triggers the GitHub Release workflow.`);
  } else {
    if (process.argv.length !== 3 || !mode) {
      throw new Error("Usage: pnpm bump <patch|minor|major|major.minor.patch>");
    }
    if (!["patch", "minor", "major"].includes(mode)) validateVersion(mode);
    // Explicit prefix for bump; direct pnpm version is normalized by postversion.
    const result = spawnSync("pnpm", ["version", mode, "--tag-version-prefix", ""], { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function requireCleanTree() {
  if (git("status", "--porcelain")) {
    throw new Error("Release requires a clean working tree. Commit or stash changes first (including untracked files).");
  }
}

function branch() {
  const name = git("symbolic-ref", "--quiet", "--short", "HEAD");
  if (!name) throw new Error("Release requires a branch, not detached HEAD.");
  return name;
}

function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Only stable major.minor.patch versions are supported.");
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function compareVersions(left, right) {
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}
