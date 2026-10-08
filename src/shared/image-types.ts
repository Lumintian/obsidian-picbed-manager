/** The image formats Picbed Manager uploads, by lowercase file extension. */
const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

export const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set(
  Object.values(IMAGE_MIME_TYPES),
);

/** Encodes image bytes as a `data:` URL. */
export function toImageDataURL(bytes: ArrayBuffer, mimeType: string): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  // Chunked so large images do not exceed the argument limit of fromCharCode.
  for (let offset = 0; offset < view.length; offset += 0x8000) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Returns the MIME type of a supported image extension, or `undefined`. */
export function imageMimeTypeForExtension(extension: string): string | undefined {
  return IMAGE_MIME_TYPES[extension.toLowerCase()];
}
