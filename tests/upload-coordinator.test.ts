import { describe, expect, it, vi } from "vitest";
import { UploadError } from "../src/domain/errors";
import type { ProviderAdapter } from "../src/domain/provider";
import type { ReferenceAdapter } from "../src/domain/reference";
import { UploadCoordinator } from "../src/operations/upload-coordinator";
import { cloneDefaultProfile } from "../src/settings/model";

const source = {
  sourceId: "source-1",
  fileName: "image.png",
  mimeType: "image/png",
  bytes: new Uint8Array([1]).buffer,
  origin: "paste" as const,
};
const result = {
  url: "https://img.test/a.png",
  profileId: "default",
  uploadedAt: "2026-07-18T00:00:00.000Z",
};

describe("UploadCoordinator", () => {
  it("retries retryable provider failures", async () => {
    const upload = vi
      .fn<ProviderAdapter["upload"]>()
      .mockRejectedValueOnce(new UploadError("network", "offline", { retryable: true }))
      .mockResolvedValueOnce(result);
    const reference = createReference();
    const onAssetCreated = vi.fn();
    const coordinator = new UploadCoordinator(
      { kind: "custom-api", upload },
      reference,
      { onJobChanged: vi.fn(), onAssetCreated, onHistory: vi.fn() },
    );
    const job = coordinator.create(source, configuredProfile(), {});
    const completed = await coordinator.run(job.id, 1);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(completed.status).toBe("succeeded");
    expect(completed.attempts).toBe(2);
    expect(reference.commit).toHaveBeenCalledOnce();
    expect(onAssetCreated).toHaveBeenCalledOnce();
  });

  it("records a remote asset even when editor commit conflicts", async () => {
    const reference = createReference();
    reference.commit = vi.fn(async () => {
      throw new UploadError("reference-conflict", "marker removed");
    });
    const onAssetCreated = vi.fn();
    const coordinator = new UploadCoordinator(
      { kind: "custom-api", upload: vi.fn(async () => result) },
      reference,
      { onJobChanged: vi.fn(), onAssetCreated, onHistory: vi.fn() },
    );
    const job = coordinator.create(source, configuredProfile(), {});
    const completed = await coordinator.run(job.id, 0);

    expect(completed.status).toBe("failed");
    expect(completed.result?.url).toBe(result.url);
    expect(onAssetCreated).toHaveBeenCalledOnce();
  });
});

function configuredProfile() {
  const profile = cloneDefaultProfile();
  profile.endpoint = "https://api.test/upload";
  return profile;
}

function createReference(): ReferenceAdapter<Record<string, never>> & {
  commit: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} {
  return {
    insertPending: () => ({ token: "marker" }),
    commit: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
}
