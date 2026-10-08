# Releasing

## Commands

Both commands support `patch`, `minor`, `major`, or an explicit stable `major.minor.patch` version:

```bash
pnpm bump patch        # 0.2.0 → 0.2.1
pnpm version minor     # 0.2.0 → 0.3.0
pnpm bump 0.4.2        # explicit version
pnpm version 0.4.2     # equivalent; choose one command, not both
```

**These commands publish automatically.** Start with a clean working tree (including untracked files), matching `package.json` / `manifest.json` versions, a named branch, and a reachable `origin` with push permission. Commit the release tooling before using it. The version must increase; prerelease versions are not supported.

## What the lifecycle does

The shared lifecycle in `scripts/version-bump.mjs` synchronizes `package.json`, `manifest.json`, and the `minAppVersion` entry in `versions.json`, commits the version files, creates a bare version tag such as `0.3.0` (required by Obsidian), and atomically pushes the current branch and that tag to `origin`. `pnpm version`'s default local `v`-prefixed tag is replaced with the bare version tag. Do not use `--no-git-tag-version` or bypass lifecycle scripts.

## Release workflow

The GitHub Actions release workflow (`.github/workflows/release.yml`) runs **only on version tag pushes**, not on ordinary commits or branch pushes. It validates the version files, runs `pnpm check` (including production compilation), and publishes `main.js`, `manifest.json`, and `styles.css` in a GitHub Release. Enable GitHub Actions in the remote repository; the workflow uses `GITHUB_TOKEN` with `contents: write` permission.

## When something fails

If pushing fails, the release commit and tag remain local and the command prints the exact `git push --atomic ...` command to retry. Do not bump again just to retry publishing. If validation or a commit hook fails after pnpm has changed `package.json`, inspect `git status` and restore the incomplete version changes before retrying. If the remote workflow fails, fix its cause and rerun the failed job; the workflow supports re-uploading release assets.
