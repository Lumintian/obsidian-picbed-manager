# Picbed Manager

Picbed Manager is an Obsidian plugin for uploading pasted Markdown images and local images from an Excalidraw drawing to a configurable Custom Upload API.

## MVP scope

- Single-image paste in a Markdown editor
- Named Custom Upload API profiles
- Configurable endpoint, multipart field, extra fields, headers, timeout, and JSON response paths
- Unique pending reference per upload
- Retryable timeout, network, and server-side failures
- Upload status/history view
- Provider-neutral asset metadata for future deletion support
- Excalidraw image upload command using ExcalidrawAutomate

Not currently included: drag/drop, automatic Excalidraw paste interception, PDF-specific behavior, Imgur-specific behavior, or remote deletion.

## Custom Upload API

The plugin sends `multipart/form-data` with the image under the configured file field. The response must be JSON. Configure **Response URL path** with a dot path such as `url` or `data.link`. Numeric array indexes are supported (`0.publicUrl`), and a single-item root array is automatically unwrapped, so `publicUrl` also works for `[{ "publicUrl": "..." }]`.

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

- API endpoint: required; copy the full upload URL from the image host documentation.
- Multipart file field: required; use the documented file parameter, commonly `file` or `image`.
- Response URL path: required; for the example above use `data.url`.
- HTTP headers: optional; add only authentication or custom headers required by the API.
- Extra form fields: optional; add only documented multipart text parameters.
- Response asset ID path: optional; for the example above use `data.id`.
- Response delete descriptor path: optional; for the example above use `data.delete` and note that deletion is not implemented yet.

The settings page includes a collapsible mapping guide, required/optional labels, examples, and a profile validation action. Multiple profiles are managed as horizontal tabs so only the selected profile's fields are shown.

## Excalidraw

With the [Excalidraw Obsidian plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) enabled, open a drawing and run **Upload images in current Excalidraw drawing** from the command palette. Selected image elements are uploaded; when no image is selected, the command asks whether to upload all image elements. Existing external image links and images that cannot be mapped to a vault file are left unchanged. The command uploads the file bytes through the selected Custom Upload API profile and keeps the local file, so it works on desktop and mobile without the PicGo Server path-list protocol.

### CloudFlare ImgBed example

For the [CloudFlare ImgBed upload API](https://cfbed.sanyue.de/api/upload.html), a normal upload profile can use:

- API endpoint: `https://your.domain/upload` plus any required query parameters, for example `?authCode=YOUR_CODE&uploadChannel=telegram`
- Multipart file field: `file`
- Response URL path: `publicUrl` when your backend returns it; otherwise use `src`
- Response URL base: leave empty for `publicUrl`; when using a relative `src` such as `/file/...`, enter the image host origin, for example `https://your.domain`
- Response asset ID path: leave empty unless you have another stable ID mapping
- Headers: optional; when using an API Token, add the authorization header required by your deployment

Its successful response is a single-item root array:

```json
[
  {
    "src": "/file/abc123_image.jpg",
    "publicUrl": "https://img.example.com/abc123_image.jpg"
  }
]
```

If `publicUrl` is not returned by the server configuration, configure **Response URL path** as `src` and **Response URL base** as the public image host origin. Alternatively, configure the backend's default URL prefix so future responses include `publicUrl`, or request its full return format where appropriate.

Per-note auto-upload can be overridden with frontmatter:

```yaml
---
picbed-auto-upload: false
---
```

## Development

```bash
npm install
npm run check
```

`npm run check` is the canonical final gate: lint, type-check, unit tests, and production build run once each. Use focused commands such as `npm test -- tests/path-selector.test.ts` while iterating.

The build produces `main.js`. Install `main.js`, `manifest.json`, and `styles.css` in a vault plugin directory named `picbed-manager` for manual testing.
