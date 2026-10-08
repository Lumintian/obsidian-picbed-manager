# Development

## Requirements

- Node.js 22.9 or later. The build scripts use `node --env-file-if-exists`; the release workflow runs Node 24.
- pnpm 12.5.1, pinned by the `packageManager` field in `package.json`. Use `corepack enable` or install that version directly.
- Git. The release script tests create temporary Git repositories.

## Setup

```bash
pnpm install
pnpm check
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Builds `main.js` in watch mode with inline source maps. |
| `pnpm build` | Builds a minified production `main.js`. |
| `pnpm check` | Runs lint, type-check, unit tests, and a production build once each. This is the final gate before committing, and the release workflow runs it too. |
| `pnpm lint` | Runs ESLint on `src` and `tests`. |
| `pnpm typecheck` | Runs `tsc --noEmit`. |
| `pnpm test` | Runs the Vitest suite. Pass a file to run one, for example `pnpm test tests/path-selector.test.ts`. |
| `pnpm coverage` | Runs the suite with V8 coverage. The text report prints to the terminal and the HTML report goes to `coverage/`. |
| `pnpm bump` / `pnpm version` | Releases a new version. See [Releasing](releasing.md). |

## Testing in a vault

Copy `.env.example` to `.env` (it is git-ignored) and set `OBSIDIAN_PLUGIN_DIR` to a vault's plugin folder:

```bash
OBSIDIAN_PLUGIN_DIR=~/Vaults/Test/.obsidian/plugins/picbed-manager
```

After every successful build, `pnpm dev` and `pnpm build` copy `main.js`, `manifest.json`, and `styles.css` into that folder and create a `.hotreload` marker, so the [Hot Reload](https://github.com/pjeby/hot-reload) plugin reloads Picbed Manager automatically. A leading `~/` is expanded. `pnpm check` does not load `.env`, so it writes to the vault only if `OBSIDIAN_PLUGIN_DIR` is exported in your shell.

Without `.env`, copy the three files into `<vault>/.obsidian/plugins/picbed-manager/` yourself and reload Obsidian.

## Tests

Tests live in `tests/*.test.ts` and run in Vitest's Node environment.

- **`obsidian` stub.** The `obsidian` package ships type declarations only, so `vitest.config.ts` aliases it to `tests/support/obsidian-runtime.ts`. The stub provides empty classes so modules that import Obsidian can load and be measured for coverage; tests pass in their own fakes for any behavior they exercise.
- **Excalidraw fake.** `tests/support/fake-excalidraw.ts` models the ExcalidrawAutomate behavior described in [Architecture](architecture.md#excalidraw-integration): `getAPI()` returns a new instance, staged copies live in a workbench, `addElementsToView()` writes every staged element back without clearing, and pasted images have no vault file until Excalidraw saves. Earlier tests used a fake that did not behave this way and hid real bugs, so keep it faithful when Excalidraw changes.
- **Release script.** `tests/version-bump.test.ts` runs the release lifecycle against temporary Git repositories with a local bare remote. It needs `git` and `pnpm` on `PATH`.

### Manual checks

Unit tests cannot prove the integration with a running Obsidian and Excalidraw. Before a release, check in a test vault:

- Markdown: paste an image (link inserted); paste with the API unreachable (a local attachment is embedded, then **Retry** in the status view swaps in the hosted link); paste and switch the tab to another note before the upload finishes (the link lands in the original note); a note with `picbed-auto-upload: false`.
- Excalidraw: paste an image (it switches to the hosted URL); paste two images quickly (both upload); move an uploaded image, then paste another (the first stays where you moved it); paste in one drawing, then in another (no images move between drawings); run the upload command with a selection and with nothing selected.
- Mobile, if the change touches uploading or the paste handlers.

## Conventions

- TypeScript runs in `strict` mode with `noUncheckedIndexedAccess`. ESLint additionally requires `import type` for type-only imports and forbids `any`.
- Keep Obsidian- and Excalidraw-specific code at the edges (`src/main.ts`, `src/integrations/`, the reference adapters, the transport) so the rest can be tested without them.
- Commit messages follow Conventional Commits with an optional scope, for example `fix(excalidraw): …`, `build(dev): …`, or `docs: …`.
