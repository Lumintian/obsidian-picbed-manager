import type { CachedMetadata } from "obsidian";

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/tiff",
  "image/webp",
]);

export function getSingleSupportedImage(
  clipboardData: DataTransfer | null,
): File | undefined {
  if (!clipboardData || clipboardData.files.length !== 1) return undefined;
  const file = clipboardData.files.item(0);
  if (!file || !SUPPORTED_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
    return undefined;
  }
  return file;
}

export function noteAllowsAutoUpload(
  metadata: CachedMetadata | null | undefined,
  defaultValue: boolean,
): boolean {
  const configured = metadata?.frontmatter?.["picbed-auto-upload"];
  return typeof configured === "boolean" ? configured : defaultValue;
}
