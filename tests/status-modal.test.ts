import { describe, expect, it } from "vitest";
import { UploadError } from "../src/domain/errors";
import type { OperationHistoryEntry, UploadJob } from "../src/domain/upload-job";
import { mergeLatest } from "../src/ui/status-modal";

function historyEntry(
  overrides: Partial<OperationHistoryEntry> = {},
): OperationHistoryEntry {
  return {
    id: "upload-1",
    fileName: "image.png",
    profileId: "default",
    status: "failed",
    attempts: 1,
    createdAt: "2026-07-18T00:00:00.000Z",
    completedAt: "2026-07-18T00:00:01.000Z",
    errorCode: "network",
    errorMessage: "Connection failed.",
    ...overrides,
  };
}

function job(overrides: Partial<UploadJob> = {}): UploadJob {
  return {
    id: "upload-1",
    source: {
      sourceId: "source-1",
      fileName: "image.png",
      bytes: new ArrayBuffer(0),
      origin: "paste",
    },
    profileId: "default",
    status: "failed",
    attempts: 1,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:01.000Z",
    error: new UploadError("network", "Connection failed."),
    ...overrides,
  };
}

describe("mergeLatest", () => {
  it("does not offer retry for failures saved by an earlier session", () => {
    expect(mergeLatest([], [historyEntry()])).toEqual([
      {
        id: "upload-1",
        fileName: "image.png",
        status: "failed",
        message: "Connection failed.",
        url: undefined,
        retryable: false,
      },
    ]);
  });

  it("offers retry for a failed job that is still in memory", () => {
    const [item] = mergeLatest([job()], [historyEntry()]);

    expect(item?.retryable).toBe(true);
  });

  it("shows the hosted URL even when inserting the link failed", () => {
    const uploaded = job({
      result: {
        url: "https://img.test/a.png",
        profileId: "default",
        uploadedAt: "2026-07-18T00:00:01.000Z",
      },
      error: new UploadError("reference-conflict", "Marker removed."),
    });

    expect(mergeLatest([uploaded], [])).toEqual([
      expect.objectContaining({
        message: "Marker removed.",
        url: "https://img.test/a.png",
      }),
    ]);
    expect(
      mergeLatest([], [historyEntry({ url: "https://img.test/a.png" })])[0]?.url,
    ).toBe("https://img.test/a.png");
  });
});
