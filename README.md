# Picbed Manager

Picbed Manager is an Obsidian plugin for uploading a single pasted image to a configurable Custom Upload API and replacing the pending Markdown reference with the returned remote URL.

## MVP scope

- Single-image paste in a Markdown editor
- Named Custom Upload API profiles
- Configurable endpoint, multipart field, extra fields, headers, timeout, and JSON response paths
- Unique pending reference per upload
- Retryable timeout, network, and server-side failures
- Upload status/history view
- Provider-neutral asset metadata for future deletion support
- Reference-adapter boundary for future Excalidraw support

Not currently included: drag/drop, command-based upload, multi-image upload, PDF-specific behavior, Imgur-specific behavior, Excalidraw integration, or remote deletion.

## Custom Upload API

The plugin sends `multipart/form-data` with the image under the configured file field. The response must be JSON. Configure **Response URL path** with a dot path such as `url` or `data.link`.

Example response:

```json
{
  "data": {
    "url": "https://images.example.com/example.png",
    "id": "asset-123",
    "delete": {
      "token": "provider-specific-value"
    }
  }
}
```

Related profile paths:

- Response URL path: `data.url`
- Response asset ID path: `data.id` (optional)
- Response delete descriptor path: `data.delete` (optional; retained for future deletion support only)

Per-note auto-upload can be overridden with frontmatter:

```yaml
---
picbed-auto-upload: false
---
```

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

The build produces `main.js`. Install `main.js`, `manifest.json`, and `styles.css` in a vault plugin directory named `picbed-manager` for manual testing.
