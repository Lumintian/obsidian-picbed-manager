export type UploadErrorCode =
  | "invalid-config"
  | "cancelled"
  | "timeout"
  | "network"
  | "http"
  | "invalid-json"
  | "missing-response-value"
  | "invalid-response-value"
  | "reference-conflict"
  | "unknown";

export class UploadError extends Error {
  readonly code: UploadErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    code: UploadErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(message);
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    this.name = "UploadError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export function toUploadError(error: unknown): UploadError {
  if (error instanceof UploadError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new UploadError("cancelled", "Upload was cancelled.");
  }
  if (error instanceof Error) {
    return new UploadError("unknown", error.message, { cause: error });
  }
  return new UploadError("unknown", "An unknown upload error occurred.", {
    cause: error,
  });
}
