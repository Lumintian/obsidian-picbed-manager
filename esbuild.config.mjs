import esbuild from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";
const pluginDir = resolvePluginDir(process.env.OBSIDIAN_PLUGIN_DIR);
const pluginFiles = ["main.js", "manifest.json", "styles.css"];

/** Copies every successful build into a vault plugin folder for manual testing. */
const copyToVault = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd(async (result) => {
      if (!pluginDir || result.errors.length > 0) return;
      await mkdir(pluginDir, { recursive: true });
      await Promise.all(
        pluginFiles.map((file) => copyFile(file, path.join(pluginDir, file))),
      );
      // The Hot Reload community plugin reloads plugin folders with this marker.
      await writeFile(path.join(pluginDir, ".hotreload"), "", { flag: "a" });
      console.log(`Copied ${pluginFiles.join(", ")} to ${pluginDir}`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
  plugins: [copyToVault],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}

function resolvePluginDir(value) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const expanded = trimmed.startsWith("~/")
    ? path.join(homedir(), trimmed.slice(2))
    : trimmed;
  const resolved = path.resolve(expanded);
  return resolved === process.cwd() ? undefined : resolved;
}
