# Picbed Manager

Picbed Manager uploads the images you paste into Obsidian to your own image host and inserts the hosted link instead of saving the image in your vault. It works with any upload API that accepts a `multipart/form-data` request and answers with JSON, and it also uploads images in [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) drawings.

## Features

- **Paste to upload in Markdown notes.** Paste an image and get `![image.png](https://…)` once the upload finishes.
- **Excalidraw support.** Pasted images are uploaded automatically, and a command uploads the images already in a drawing.
- **Works with your own image host.** Configure the endpoint, file field, headers, extra form fields, timeout, and where the image URL is in the JSON response.
- **Multiple upload profiles.** Keep several hosts configured and choose which one is the default.
- **Automatic retries** for timeouts, network errors, and server errors.
- **Upload status view** with recent uploads and a retry button for failed ones.
- **Per-note switch.** Turn automatic upload off (or on) for a single note with frontmatter.
- Works on desktop and mobile.

## Installation

Picbed Manager requires Obsidian 1.5.0 or later.

**Manual installation**

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub release](https://github.com/Lumintian/obsidian-picbed-manager/releases).
2. Put them in `<your vault>/.obsidian/plugins/picbed-manager/`.
3. Reload Obsidian, then enable **Picbed Manager** in **Settings → Community plugins**.

**With BRAT**

If you use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, add the beta plugin `Lumintian/obsidian-picbed-manager`. BRAT installs the latest release and keeps it updated.

## Quick start

1. Open **Settings → Picbed Manager**.
2. In the **Default API** profile, fill in **API endpoint**, **Multipart file field**, and **Response URL path** (see [Configuring your upload API](#configuring-your-upload-api)).
3. Click **Validate profile** to check the settings.
4. Paste an image into a note. A placeholder appears while the image uploads and is replaced by the image link when it finishes.

**Validate profile** only checks the settings; it does not contact your API. Pasting one image is the real test of your response mapping.

## Usage

### Markdown notes

When **Upload pasted images** is on, pasting a single image into a note:

1. Inserts a placeholder such as `⏳ Uploading image.png…` at the cursor.
2. Uploads the image with your default profile.
3. Replaces the placeholder with `![image.png](https://your.host/…)`.

If the upload fails, the placeholder changes to `⏳ Upload failed: image.png — <reason>`. You can retry it from the [upload status view](#upload-status) while Obsidian stays open, or delete the placeholder and paste again. Do not edit the placeholder while an upload is running; Picbed Manager uses it to find where the link goes.

Supported image types: PNG, JPEG, GIF, WebP, SVG, AVIF, BMP, and TIFF. Pasting several files at once, or pasting where Picbed Manager does not handle images (see [Known limitations](#known-limitations)), keeps Obsidian's normal behavior.

To change automatic upload for one note, add this frontmatter:

```yaml
---
picbed-auto-upload: false
---
```

Use `true` to upload in that note even when **Upload pasted images** is off.

### Excalidraw

With the Excalidraw plugin enabled:

- **Paste:** a single pasted image is uploaded automatically. Excalidraw inserts it as usual, and once the upload finishes the image points to the hosted URL. If the upload fails, the image stays in the drawing as a normal local image. Images pasted while another upload is running wait their turn.
- **Command:** run **Picbed Manager: Upload images in current Excalidraw drawing** from the command palette to upload the selected images. If nothing is selected, you are asked whether to upload every image in the drawing. Images that already use a web link are left alone, and the original files stay in your vault.

### Upload status

Click the **Picbed upload status** icon in the ribbon to see recent uploads, their links or error messages, and a **Retry** button for failed ones. **Clear history** removes the saved list.

## Configuring your upload API

Picbed Manager sends one `POST` request per image as `multipart/form-data`, with the image in the file field you configure. The API must answer with JSON that contains the image URL. The settings page has a collapsible guide, **How to map your image host API**, with the same steps.

### Profile fields

| Field | Required | What to enter |
|---|---|---|
| Profile name | Yes | Any name that helps you tell profiles apart. |
| API endpoint | Yes | The full upload URL from your image host's documentation, including any required query parameters. |
| Multipart file field | Yes | The form field that carries the image, often `file` or `image`. |
| Response URL path | Yes | Where the image URL is in the JSON response, for example `data.url`. See below. |
| Response URL base | No | Only needed when the API returns a relative URL such as `/file/a.png`. Enter the image host origin, for example `https://img.example.com`. |
| Response asset ID path | No | Where the API returns the image's ID, for example `data.id`. Saved with the upload record. |
| Response delete descriptor path | No | Where the API returns deletion data, for example `data.delete`. Saved with the upload record; deleting remote images is not supported yet. |
| Timeout (seconds) | Yes | How long to wait for the API, from 1 to 300. Default: 30. |
| HTTP headers | No | Authentication or other headers the API requires, such as `Authorization`. Do not add `Content-Type`; it is set for you. |
| Extra form fields | No | Additional text fields the API expects in the same request, such as an album or folder name. |

Turn on the toggle next to a header value to treat it as a secret: the value is hidden in the settings and removed from error messages.

### Finding the response URL path

Write the path to the URL as keys separated by dots. For this response:

```json
{
  "data": {
    "url": "https://images.example.com/example.png",
    "id": "asset-123",
    "delete": { "token": "provider-specific-value" }
  }
}
```

use `data.url` for **Response URL path**, `data.id` for **Response asset ID path**, and `data.delete` for **Response delete descriptor path**.

- Use numbers for list items: `files.0.url` is the `url` of the first entry in `files`.
- If the whole response is a list with one item, such as `[{ "publicUrl": "…" }]`, you can write `publicUrl` directly (`0.publicUrl` also works). A response list with several items needs the number, for example `0.publicUrl`.
- If the path is wrong, the error message lists the fields the response does contain.

### Multiple profiles

Click **Add profile** to configure another host. Profiles appear as tabs; the one marked **Default** is used for every upload. Use **Set as default** to switch, and **Remove profile** to delete one (at least one profile always remains).

### Example: CloudFlare ImgBed

For the [CloudFlare ImgBed upload API](https://cfbed.sanyue.de/api/upload.html):

- **API endpoint:** `https://your.domain/upload` plus the query parameters you need, for example `?authCode=YOUR_CODE&uploadChannel=telegram`
- **Multipart file field:** `file`
- **Response URL path:** `publicUrl` if your server returns it, otherwise `src`
- **Response URL base:** leave empty with `publicUrl`; with `src` (which is relative, such as `/file/…`), enter your image host origin, for example `https://your.domain`
- **HTTP headers:** add the authorization header your deployment requires if you use an API token

A successful upload returns a one-item list:

```json
[
  {
    "src": "/file/abc123_image.jpg",
    "publicUrl": "https://img.example.com/abc123_image.jpg"
  }
]
```

If your server does not return `publicUrl`, either use `src` with **Response URL base**, or set a default URL prefix on the server so `publicUrl` is included.

## Settings

| Setting | Default | Description |
|---|---|---|
| Upload pasted images | On | Upload a single pasted image automatically in Markdown notes and Excalidraw. |
| Preserve file name as alt text | On | Use the pasted file's name as the image's alt text in Markdown. |
| Automatic retry count | 1 | How many times to retry after a timeout, network error, or server error (HTTP 5xx). Other errors are not retried. |

## Privacy and security

- Images are sent only to the API endpoints you configure. Picbed Manager makes no other network requests.
- Settings, including header values and endpoint URLs, are stored as plain text in `<your vault>/.obsidian/plugins/picbed-manager/data.json`, together with your upload history. If you sync or back up your vault, this file goes with it. Marking a header as secret hides it in the settings and in error messages, but does not encrypt it.

## Known limitations

- One image per paste. Drag and drop is not supported.
- Paste in Canvas cards and in embedded or pop-up editors uses Obsidian's normal behavior and is not uploaded.
- In Markdown notes, a failed upload does not save the image to your vault. Retry it from the status view before restarting Obsidian, or paste it again. After a restart, **Retry** does not work for older failed uploads.
- If you switch the tab to another note, or edit the placeholder, before an upload finishes, the link is not inserted and the placeholder stays.
- In Excalidraw, the `picbed-auto-upload` frontmatter setting is ignored.
- The Excalidraw command can also pick up embedded notes, PDF pages, and other drawings, which are shown as images. Select only the images you want to upload instead of uploading everything.
- A request that times out may still finish on the server, so a retry can leave a duplicate copy on your image host.
- Removing a link does not delete the image from your image host.

## Troubleshooting

| Message | What to do |
|---|---|
| Configure a valid Picbed Manager upload profile first. | Fill in **API endpoint** in the default profile. |
| Response path "…" was not found. Available response fields: … | Change **Response URL path** to one of the listed fields. |
| Response URL "…" is relative. Configure Response URL base… | Set **Response URL base** to your image host origin. |
| Upload API returned HTTP 401 / 403. | Check the authentication header, token, or query parameter. |
| Upload API returned invalid JSON. | The API must answer with JSON; APIs that return only plain text are not supported. |
| Upload timed out after … seconds. | Increase **Timeout (seconds)**, or check that the endpoint is reachable from this device. |
| Picbed Manager could not find the pasted image in Excalidraw… | Excalidraw did not insert the pasted image within 10 seconds. Run the upload command after Excalidraw has saved the drawing. |

## Development

Developer documentation, including the build setup, architecture, and release process, is in [`docs/`](docs/README.md).
