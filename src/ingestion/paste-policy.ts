import type { CachedMetadata } from "obsidian";
import { SUPPORTED_IMAGE_MIME_TYPES } from "../shared/image-types";

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
