import { UploadError } from "../../domain/errors";

export function getValueAtPath(input: unknown, path: string): unknown {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return input;

  let current = input;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function getRequiredStringAtPath(input: unknown, path: string): string {
  const value = getValueAtPath(input, path);
  if (value === undefined || value === null) {
    throw new UploadError(
      "missing-response-value",
      `Response path "${path}" was not found.`,
    );
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new UploadError(
      "invalid-response-value",
      `Response path "${path}" must contain a non-empty string.`,
    );
  }
  return value;
}
