// Sets one release version in package.json, manifest.json, and versions.json.
// Usage: pnpm bump <major.minor.patch>
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const version = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail("Usage: pnpm bump <major.minor.patch>");
}

const pkg = await readJson("package.json");
const manifest = await readJson("manifest.json");
const versions = await readJson("versions.json");

if (compareVersions(version, manifest.version) <= 0) {
  fail(`Version ${version} must be newer than ${manifest.version}.`);
}

pkg.version = version;
manifest.version = version;
// Obsidian reads this map to offer older releases to older app versions.
versions[version] = manifest.minAppVersion;

await writeJson("package.json", pkg);
await writeJson("manifest.json", manifest);
await writeJson("versions.json", versions);
console.log(
  `Bumped to ${version} (minAppVersion ${manifest.minAppVersion}). Commit, then tag it as ${version} without a "v" prefix.`,
);

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
