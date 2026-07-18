import type { AssetSource } from "../../domain/asset";
import type { UploadProfile } from "../../settings/model";

export interface MultipartBody {
  body: ArrayBuffer;
  contentType: string;
}

function escapeQuoted(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}

function randomBoundary(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `PicbedManagerBoundary${suffix.replaceAll("-", "")}`;
}

export async function createMultipartBody(
  source: AssetSource,
  profile: UploadProfile,
): Promise<MultipartBody> {
  const boundary = randomBoundary();
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const append = (value: string): void => {
    chunks.push(encoder.encode(value));
  };

  for (const field of profile.extraFields) {
    if (!field.name.trim()) continue;
    append(`--${boundary}\r\n`);
    append(
      `Content-Disposition: form-data; name="${escapeQuoted(field.name.trim())}"\r\n\r\n`,
    );
    append(`${field.value}\r\n`);
  }

  append(`--${boundary}\r\n`);
  append(
    `Content-Disposition: form-data; name="${escapeQuoted(profile.fileField.trim())}"; filename="${escapeQuoted(source.fileName)}"\r\n`,
  );
  append(`Content-Type: ${source.mimeType || "application/octet-stream"}\r\n\r\n`);
  chunks.push(new Uint8Array(source.bytes));
  append(`\r\n--${boundary}--\r\n`);

  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    body: body.buffer,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
