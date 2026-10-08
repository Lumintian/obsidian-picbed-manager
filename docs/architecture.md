# Architecture

## Overview

Every upload follows the same path, whichever way it starts:

```text
Markdown paste ─┐
Excalidraw paste├─► AssetSource ─► UploadCoordinator ─┬─► ProviderAdapter  (send the bytes, get a URL)
Excalidraw cmd ─┘   (bytes,        (job, retries,     └─► ReferenceAdapter (placeholder, then link)
                     name, type)    history)
                                         │
                                         └─► callbacks ─► data.json (assets, history)
```

The upload side (`ProviderAdapter`) and the document side (`ReferenceAdapter`) are interfaces, so the coordinator does not know which image host or which kind of document it is working with.

## Source layout

| Path | Responsibility |
|---|---|
| `src/main.ts` | Plugin entry point. Wires the parts together, handles Markdown `editor-paste`, registers the command, ribbon icon, and Excalidraw hook, and persists assets and history. |
| `src/domain/` | Shared types: `AssetSource` / `AssetResult` / `AssetRecord`, `UploadJob` and history entries, `UploadError`, and the `ProviderAdapter` and `ReferenceAdapter` interfaces. |
| `src/ingestion/paste-policy.ts` | Decides which clipboard contents qualify (exactly one supported image) and applies the `picbed-auto-upload` frontmatter override. |
| `src/operations/upload-coordinator.ts` | Runs one upload job from placeholder to link, including retries. |
| `src/providers/custom-api/` | The Custom Upload API provider: request building, the multipart body, headers and secret redaction, JSON path selection, and the Obsidian `requestUrl` transport. |
| `src/references/` | `markdown-adapter.ts` (placeholder markers in the editor) and `excalidraw-adapter.ts` (ExcalidrawAutomate types and the image-to-link commit). |
| `src/integrations/excalidraw-uploader.ts` | Finds the Excalidraw plugin, owns the paste hook and watcher, implements the upload command, and runs Excalidraw uploads through one queue. |
| `src/settings/` | Settings model and defaults, migration, profile validation, field help texts, and the settings tab. |
| `src/persistence/state.ts` | The shape of `data.json` and its migration. |
| `src/ui/status-modal.ts` | The upload status view. |
| `src/shared/id.ts` | ID generation. |

## Upload lifecycle

`UploadCoordinator` drives each job:

1. **`create`** builds an `UploadJob`, asks the reference adapter to insert a placeholder, and keeps the operation in memory.
2. **`run`** tries the upload up to `retryCount + 1` times. After a successful upload it first reports the asset (`onAssetCreated`, which saves it to `data.json`), then commits the link through the reference adapter. Recording the asset first means an uploaded image is never lost from the record, even if the document changed in the meantime.
3. A failure is retried only if the error is retryable and was not a cancellation. When the attempts run out, the reference adapter's `fail` updates the placeholder, and the finished job is written to history.
4. **`retry`** runs the same in-memory operation again with a fresh `AbortController`. Operations are kept for the whole session and are not restored after a restart.

### Error codes

| Code | Retryable | Raised when |
|---|---|---|
| `invalid-config` | No | The profile fails validation, or **Response URL base** is not a valid URL. |
| `timeout` | Yes | No response within the profile timeout. |
| `network` | Yes | The transport throws, for example because the host is unreachable. |
| `http` | Only for 5xx | The API answers with a status outside 200–299. |
| `invalid-json` | No | The response body is not JSON. |
| `missing-response-value` | No | **Response URL path** does not exist in the response. |
| `invalid-response-value` | No | The selected value is empty or has the wrong type, or the URL is relative and no base is set. |
| `reference-conflict` | No | The placeholder or Excalidraw element changed or disappeared before the link could be inserted. |
| `cancelled` | No | The job's `AbortSignal` fired. |
| `unknown` | No | Anything else. |

## Custom Upload API adapter

`CustomApiAdapter.upload`:

1. Validates the profile (`src/settings/validation.ts`).
2. Builds the multipart body: extra form fields first, then the file under the configured field name. Quotes, backslashes, and line breaks in field names and file names are replaced with `_`.
3. Builds headers from the profile and sets `Content-Type` last, with the multipart boundary.
4. Races the transport against the timeout and the abort signal. Obsidian's `requestUrl` cannot be aborted, so a timed-out or cancelled request may still complete on the server.
5. Accepts only 2xx responses, parses the JSON, selects the URL with the path selector, and resolves a relative URL against **Response URL base**. The asset ID and delete descriptor paths are optional.

All error messages pass through `redactSecrets`, which replaces the values of headers marked as secret.

**Path selector** (`path-selector.ts`): the path is split on dots. Numeric segments index arrays. When the response root is an array with exactly one item and the path does not start with an index, that item is used as the root. When a path is missing, the error lists up to ten top-level fields of the response.

## Markdown references

The placeholder is a single line, `⏳ <status text> <!-- picbed-manager-upload:<jobId> -->`. The HTML comment carries a unique token, is invisible in Reading view, and loads no resources.

`commit` and `fail` search the editor's full text for the token. They replace everything from the `⏳ ` before it to the end of that line with the image link or the failure text. If the token is gone, they raise `reference-conflict`. The adapter writes through the `Editor` captured at paste time, so it only finds the marker while that editor still shows the same note.

## Excalidraw integration

Picbed Manager uses Excalidraw only through its public ExcalidrawAutomate (EA) API and has no build-time dependency on it.

### Facts about ExcalidrawAutomate this code relies on

These come from reading the Excalidraw plugin source (`src/shared/ExcalidrawAutomate.ts`, `src/view/ExcalidrawView.ts`, and `src/shared/ExcalidrawData.ts`, October 2026). Re-check them when Excalidraw changes significantly.

- The plugin object has an `ea` property, the shared instance also exposed as `window.ExcalidrawAutomate`. The plugin object itself has **no** `getAPI`.
- `ea.getAPI(view)` creates a new EA instance targeting `view`, with its own empty workbench. `destroy()` releases it.
- Views call hooks such as `onPasteHook` on their hook server, which is the shared `ea` unless a script registered another instance.
- `copyViewElementsToEAforEditing(elements, true)` stages copies of the elements and their image data in the instance's workbench. `getElement(id)` reads that workbench, not the scene.
- `addElementsToView()` writes **every** staged element back to the scene, replacing elements with the same ID and inserting the rest. It does not clear the workbench.
- `getViewElements()` returns the scene's non-deleted elements.
- A pasted image is written to the vault only when the drawing is saved. Autosave defaults to every 60 seconds on desktop and 30 seconds on mobile, so `getViewFileForImageElement()` returns nothing for a fresh paste.

### Rules that follow

- **Never stage anything on the shared `ea`.** Staged copies would be written back by any later `addElementsToView()`, including other scripts', reverting edits or copying elements into other drawings. Reads go through `queryDrawing()`, and each commit uses its own short-lived instance from `getAPI(view)`.
- **Copy at commit time.** `ExcalidrawReferenceAdapter.commit` finds the element in the live scene right before committing, so edits made during the upload are kept and an image deleted in the meantime stays deleted. To switch the image to a link, it sets `file: null`, `isHyperLink: true`, and `hyperlink` on the staged image data and calls `addElementsToView(false, true)`.
- **One queue.** Paste uploads and command runs go through a single promise queue, so they never overlap and none are dropped.

### Paste flow

1. Picbed wraps any existing `onPasteHook` and re-registers on `layout-change` and `active-leaf-change`, because Excalidraw may load after Picbed. It restores the previous hook on unload.
2. On a paste with exactly one supported image, the hook records the IDs of the elements already in the scene, starts reading the clipboard file, and returns `true` so Excalidraw handles the paste natively.
3. A watcher polls every 100 ms, for up to 10 seconds, for a new image element. It does not wait for a vault file.
4. The upload is queued with the clipboard bytes. If the image never appears, the user is notified. Pending watchers are cancelled on unload.

### Command flow

The command reads the selection (or, after confirmation, all images) immediately, then queues the upload. When the queued task starts, it resolves each element to its vault file, so images that earlier queued work already switched to links are skipped. It reads the files and uploads them one at a time.

## Persisted data

`data.json` in the plugin folder contains:

```text
{
  settings: {
    schemaVersion: 1,
    profiles: UploadProfile[],
    defaultProfileId: string,
    behavior: { autoUploadOnPaste, preserveAltText, retryCount, historyLimit }
  },
  assets: AssetRecord[],              // every successful upload; never trimmed
  history: OperationHistoryEntry[]    // finished jobs, trimmed to historyLimit
}
```

`migrateSettings` fills in defaults and clamps ranges: `retryCount` to 0–5, `historyLimit` to 10–200 (there is no UI for it; the default is 50), and timeouts to 1–300 seconds. `migratePersistedState` also accepts older files that stored the settings at the top level. The whole file is saved on every settings change and after every finished upload.
