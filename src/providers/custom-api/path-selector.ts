import { UploadError } from "../../domain/errors";

export function getValueAtPath(input: unknown, path: string): unknown {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return input;

  let current = unwrapSingleItemRootArray(input, segments[0]);
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
      buildMissingPathMessage(input, path),
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

function unwrapSingleItemRootArray(
  input: unknown,
  firstSegment: string | undefined,
): unknown {
  if (
    Array.isArray(input) &&
    input.length === 1 &&
    firstSegment !== undefined &&
    !isArrayIndex(firstSegment)
  ) {
    return input[0];
  }
  return input;
}

function isArrayIndex(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment);
}

function buildMissingPathMessage(input: unknown, path: string): string {
  if (Array.isArray(input) && input.length > 1 && !isArrayIndex(path.split(".")[0] ?? "")) {
    return `Response path "${path}" was not found. The response root is an array with multiple items; start the path with an index such as "0.${path}".`;
  }
  return `Response path "${path}" was not found.`;
}
