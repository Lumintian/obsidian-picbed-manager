# Known issues

Open problems found in code review, with a suggested direction for each. User-visible limitations are also listed in the [README](../README.md#known-limitations).

## Bugs

- **Excalidraw paste ignores the `picbed-auto-upload` frontmatter**, unlike Markdown notes.
- **Clearing the timeout field saves 0 seconds**, so every upload fails validation until the field is fixed. After a reload the value is clamped to 1 second. *Direction:* validate the input and keep the last valid value.

## Robustness and performance

- **Timeouts and cancellation do not stop the request.** `requestUrl` cannot be aborted, so a timed-out request may still finish, and the automatic retry of a non-idempotent `POST` can leave duplicates on the host. *Direction:* do not retry timeouts by default, or make this explicit in the retry setting.
- **Finished jobs stay in memory.** `UploadCoordinator` keeps every operation, including the image bytes and the editor or view reference, until the plugin unloads. *Direction:* drop the bytes after success and prune finished operations.
- **`data.json` grows without limit and is rewritten often.** `assets` is never trimmed, and the whole file is saved on every keystroke in the settings tab. *Direction:* debounce settings saves with Obsidian's `debounce`, and cap or move the asset records.
- **The final image URL can use any scheme.** Absolute response URLs are not restricted to `http:` and `https:`.

## Security

- **Credentials are stored as plain text.** Header values and endpoint query tokens are saved in `data.json` and travel with vault sync and backups. Marking a header as secret only hides it in the UI and in error messages. *Direction:* Obsidian 1.11.4 added `app.secretStorage`; using it requires raising `minAppVersion`.

## User interface

- The settings tab adds a top-level `h2` and raw `h3`/`h4` headings; Obsidian's plugin guidelines ask for no top-level heading and `new Setting(...).setHeading()` for sections.
- Adding or removing headers, fields, or profiles, or toggling a secret, re-renders the whole tab, which resets the scroll position and focus.
- The secret toggle next to a header has only a tooltip, which is not reachable on mobile.
- **Remove profile** deletes immediately without confirmation.
- **Validate profile** checks the settings only. A "test upload" that sends a small image and shows the raw response and resolved URL would make mapping much easier.
- The status view does not update live, cannot cancel an upload, and has no timestamps or note links.
- The Excalidraw "upload all images?" prompt uses `window.confirm` instead of an Obsidian `Modal`.
- The Excalidraw command is always listed. `checkCallback` would hide it outside Excalidraw drawings; `ExcalidrawUploader.canRun()` already exists but is only used by tests.
- Pasted screenshots are usually named `image.png`, which can collide on hosts that keep file names. A file-name template would help.

## Code health

- `eslint-plugin-obsidianmd` is not configured; it would catch several of the guideline issues above.
- `getActiveExcalidrawView` uses the deprecated `workspace.activeLeaf`.
- Unused API surface: `CustomApiAdapter.test`, `UploadCoordinator.cancel`, `ProviderAdapter.delete`, and the no-op `onJobChanged` callback.
- No code formatter is configured.
- `package.json` declares the MIT license, but the repository has no `LICENSE` file.
- `pnpm check` runs in CI only as part of the release workflow, not on ordinary pushes or pull requests.
