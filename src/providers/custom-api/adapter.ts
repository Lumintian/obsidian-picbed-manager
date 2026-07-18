import type { AssetResult, AssetSource } from "../../domain/asset";
import { UploadError, toUploadError } from "../../domain/errors";
import type { ProviderAdapter, ProviderTestResult } from "../../domain/provider";
import type { UploadProfile } from "../../settings/model";
import { validateProfile } from "../../settings/validation";
import { buildHeaders, redactSecrets } from "./headers";
import { createMultipartBody } from "./multipart";
import { getRequiredStringAtPath, getValueAtPath } from "./path-selector";
import type { HttpTransport } from "./transport";

export class CustomApiAdapter implements ProviderAdapter {
  readonly kind = "custom-api" as const;

  constructor(
    private readonly transport: HttpTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async upload(
    source: AssetSource,
    profile: UploadProfile,
    signal?: AbortSignal,
  ): Promise<AssetResult> {
    const validation = validateProfile(profile);
    if (!validation.valid) {
      throw new UploadError("invalid-config", validation.errors.join(" "));
    }
    if (signal?.aborted) {
      throw new UploadError("cancelled", "Upload was cancelled.");
    }

    const multipart = await createMultipartBody(source, profile);
    const headers = buildHeaders(profile.headers, multipart.contentType);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new UploadError(
            "timeout",
            `Upload timed out after ${Math.round(profile.timeoutMs / 1_000)} seconds.`,
            { retryable: true },
          ),
        );
      }, profile.timeoutMs);
    });
    const cancelled = new Promise<never>((_, reject) => {
      signal?.addEventListener(
        "abort",
        () => reject(new UploadError("cancelled", "Upload was cancelled.")),
        { once: true },
      );
    });

    try {
      const response = await Promise.race([
        this.transport({
          url: profile.endpoint,
          method: profile.method,
          headers,
          body: multipart.body,
        }),
        timeout,
        cancelled,
      ]);

      if (response.status < 200 || response.status >= 300) {
        throw new UploadError(
          "http",
          `Upload API returned HTTP ${response.status}.`,
          { retryable: response.status >= 500, status: response.status },
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(response.text) as unknown;
      } catch (error) {
        throw new UploadError("invalid-json", "Upload API returned invalid JSON.", {
          cause: error,
        });
      }

      const url = getRequiredStringAtPath(payload, profile.responseUrlPath);
      const assetId = profile.responseAssetIdPath.trim()
        ? getOptionalString(payload, profile.responseAssetIdPath)
        : undefined;
      const deleteDescriptor = profile.responseDeletePayloadPath.trim()
        ? getValueAtPath(payload, profile.responseDeletePayloadPath)
        : undefined;

      return {
        url,
        assetId,
        deleteDescriptor,
        profileId: profile.id,
        uploadedAt: this.now().toISOString(),
      };
    } catch (error) {
      const caught = toUploadError(error);
      const normalized =
        caught.code === "unknown"
          ? new UploadError("network", caught.message, {
              retryable: true,
              cause: caught,
            })
          : caught;
      const message = redactSecrets(normalized.message, profile.headers);
      if (message === normalized.message) throw normalized;
      throw new UploadError(normalized.code, message, {
        retryable: normalized.retryable,
        status: normalized.status,
        cause: normalized,
      });
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  async test(profile: UploadProfile): Promise<ProviderTestResult> {
    const validation = validateProfile(profile);
    return validation.valid
      ? { ok: true, message: "Profile configuration is valid." }
      : { ok: false, message: validation.errors.join(" ") };
  }
}

function getOptionalString(payload: unknown, path: string): string | undefined {
  const value = getValueAtPath(payload, path);
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new UploadError(
      "invalid-response-value",
      `Response path "${path}" must contain a string or number.`,
    );
  }
  return String(value);
}
