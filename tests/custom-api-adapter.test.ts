import { describe, expect, it, vi } from "vitest";
import { CustomApiAdapter } from "../src/providers/custom-api/adapter";
import { cloneDefaultProfile } from "../src/settings/model";

const source = {
  sourceId: "source-1",
  fileName: "image.png",
  mimeType: "image/png",
  bytes: new Uint8Array([1]).buffer,
  origin: "paste" as const,
};

describe("CustomApiAdapter", () => {
  it("normalizes URL and deletion metadata", async () => {
    const transport = vi.fn(async () => ({
      status: 201,
      text: JSON.stringify({ data: { url: "https://img.test/a.png", id: 7, deletion: { token: "d" } } }),
    }));
    const profile = cloneDefaultProfile();
    profile.endpoint = "https://api.test/upload";
    profile.responseUrlPath = "data.url";
    profile.responseAssetIdPath = "data.id";
    profile.responseDeletePayloadPath = "data.deletion";
    const adapter = new CustomApiAdapter(transport, () => new Date("2026-07-18T00:00:00Z"));

    await expect(adapter.upload(source, profile)).resolves.toEqual({
      url: "https://img.test/a.png",
      assetId: "7",
      deleteDescriptor: { token: "d" },
      profileId: "default",
      uploadedAt: "2026-07-18T00:00:00.000Z",
    });
  });

  it("supports CloudFlare ImgBed single-item array responses", async () => {
    const profile = cloneDefaultProfile();
    profile.endpoint = "https://img.example.com/upload";
    profile.responseUrlPath = "publicUrl";
    const adapter = new CustomApiAdapter(async () => ({
      status: 200,
      text: JSON.stringify([
        {
          src: "/file/abc123_image.jpg",
          publicUrl: "https://img.example.com/abc123_image.jpg",
        },
      ]),
    }));

    await expect(adapter.upload(source, profile)).resolves.toMatchObject({
      url: "https://img.example.com/abc123_image.jpg",
    });
  });

  it("redacts secrets from transport errors", async () => {
    const transport = vi.fn(async () => {
      throw new Error("request failed with token top-secret");
    });
    const profile = cloneDefaultProfile();
    profile.endpoint = "https://api.test/upload";
    profile.headers = [{ name: "Authorization", value: "top-secret", secret: true }];
    const adapter = new CustomApiAdapter(transport);
    await expect(adapter.upload(source, profile)).rejects.toMatchObject({
      code: "network",
      retryable: true,
      message: expect.stringContaining("[REDACTED]"),
    });
  });

  it("marks server failures retryable", async () => {
    const profile = cloneDefaultProfile();
    profile.endpoint = "https://api.test/upload";
    const adapter = new CustomApiAdapter(async () => ({ status: 503, text: "no" }));
    await expect(adapter.upload(source, profile)).rejects.toMatchObject({
      code: "http",
      retryable: true,
      status: 503,
    });
  });
});
