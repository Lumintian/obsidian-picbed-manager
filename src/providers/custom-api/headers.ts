import type { HeaderSetting } from "../../settings/model";

export function buildHeaders(
  settings: HeaderSetting[],
  contentType: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of settings) {
    const name = header.name.trim();
    if (name) headers[name] = header.value;
  }
  headers["Content-Type"] = contentType;
  return headers;
}

export function redactSecrets(
  input: string,
  settings: HeaderSetting[],
): string {
  let output = input;
  for (const header of settings) {
    if (!header.secret || !header.value) continue;
    output = output.split(header.value).join("[REDACTED]");
  }
  return output;
}
