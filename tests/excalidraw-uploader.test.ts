import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { AssetResult } from "../src/domain/asset";
import { UploadError } from "../src/domain/errors";
import type { ProviderAdapter } from "../src/domain/provider";
import {
  ExcalidrawUploader,
  type ExcalidrawUploadSummary,
} from "../src/integrations/excalidraw-uploader";
import { cloneDefaultProfile } from "../src/settings/model";
import {
  createExcalidrawApp,
  FakeExcalidrawAutomate,
  FakeExcalidrawView,
  vaultFile,
} from "./support/fake-excalidraw";

function configuredProfile() {
  const profile = cloneDefaultProfile();
  profile.endpoint = "https://api.test/upload";
  return profile;
}

function createUploader(
  app: App,
  upload: ProviderAdapter["upload"],
  overrides: Partial<{
    notify: (message: string) => void;
    confirmUploadAll: (message: string) => boolean;
  }> = {},
): ExcalidrawUploader {
  return new ExcalidrawUploader(
    app,
    { kind: "custom-api", upload },
    {
      getProfile: configuredProfile,
      getRetryCount: () => 0,
      callbacks: {
        onJobChanged: vi.fn(),
        onAssetCreated: vi.fn(),
        onHistory: vi.fn(),
      },
      notify: overrides.notify ?? vi.fn(),
      confirmUploadAll: overrides.confirmUploadAll,
    },
  );
}

function createDrawing(name = "Drawing.excalidraw.md") {
  return new FakeExcalidrawView(vaultFile(name));
}

function uploadedTo(url: string): AssetResult {
  return { url, profileId: "default", uploadedAt: "2026-07-18T00:00:00.000Z" };
}

const uploadedResult = uploadedTo("https://img.test/diagram.png");

/** Runs the paste hook, then inserts the image as Excalidraw's native paste does. */
function pasteImage(
  host: FakeExcalidrawAutomate,
  view: FakeExcalidrawView,
  elementId: string,
  fileId: string,
): boolean | void {
  const clipboardFile = { name: "pasted.png", type: "image/png" } as File;
  const clipboardData = {
    files: { length: 1, item: () => clipboardFile },
  } as unknown as DataTransfer;
  const result = host.onPasteHook?.({
    ea: host,
    payload: {},
    event: { clipboardData } as ClipboardEvent,
    excalidrawFile: view.file,
    view,
    pointerPosition: { x: 0, y: 0 },
  });
  view.addImage(elementId, fileId, vaultFile(`${fileId}.png`));
  return result;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ExcalidrawUploader", () => {
  it("uploads a selected local image and commits its remote hyperlink", async () => {
    const view = createDrawing();
    view.addImage("element-1", "file-1", vaultFile("diagram.png"));
    view.selectedIds.add("element-1");
    const host = new FakeExcalidrawAutomate();
    const upload = vi.fn<ProviderAdapter["upload"]>(async (source) => {
      expect(source.origin).toBe("excalidraw");
      expect(source.fileName).toBe("diagram.png");
      expect(source.mimeType).toBe("image/png");
      return uploadedResult;
    });
    const uploader = createUploader(createExcalidrawApp(host, view), upload);

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary).toEqual<ExcalidrawUploadSummary>({
      total: 1,
      uploaded: 1,
      skipped: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(view.files["file-1"]).toMatchObject({
      file: null,
      isHyperLink: true,
      hyperlink: uploadedResult.url,
    });
  });

  it("never stages elements on the Excalidraw plugin's shared instance", async () => {
    const view = createDrawing();
    view.addImage("element-1", "file-1", vaultFile("diagram.png"));
    view.selectedIds.add("element-1");
    const host = new FakeExcalidrawAutomate();
    const uploader = createUploader(
      createExcalidrawApp(host, view),
      vi.fn(async () => uploadedResult),
    );

    await uploader.uploadCurrentDrawing();

    expect(host.elementsDict).toEqual({});
    expect(host.imagesDict).toEqual({});
    expect(host.instances.length).toBeGreaterThan(0);
    expect(host.instances.every((instance) => instance.destroyed)).toBe(true);
  });

  it("keeps edits made to other images while a batch is uploading", async () => {
    const view = createDrawing();
    view.addImage("element-1", "file-1", vaultFile("one.png"));
    view.addImage("element-2", "file-2", vaultFile("two.png"));
    view.selectedIds = new Set(["element-1", "element-2"]);
    const host = new FakeExcalidrawAutomate();
    const upload = vi.fn<ProviderAdapter["upload"]>(async (source) => {
      if (source.fileName === "one.png") {
        // The user moves the second image while the first one uploads.
        view.edit("element-2", { x: 500 });
      }
      return uploadedTo(`https://img.test/${source.fileName}`);
    });
    const uploader = createUploader(createExcalidrawApp(host, view), upload);

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary.uploaded).toBe(2);
    expect(view.element("element-2")?.x).toBe(500);
    expect(view.files["file-2"]?.hyperlink).toBe("https://img.test/two.png");
  });

  it("does not restore an image deleted while it was uploading", async () => {
    const view = createDrawing();
    view.addImage("element-1", "file-1", vaultFile("diagram.png"));
    view.selectedIds.add("element-1");
    const host = new FakeExcalidrawAutomate();
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => {
      view.edit("element-1", { isDeleted: true });
      return uploadedResult;
    });
    const uploader = createUploader(createExcalidrawApp(host, view), upload);

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary.failed).toBe(1);
    expect(view.element("element-1")?.isDeleted).toBe(true);
  });

  it("asks before uploading all images when no image is selected", async () => {
    const view = createDrawing();
    view.addImage("element-1", "file-1", vaultFile("diagram.png"));
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    const confirmUploadAll = vi.fn(() => false);
    const uploader = createUploader(
      createExcalidrawApp(new FakeExcalidrawAutomate(), view),
      upload,
      { confirmUploadAll },
    );

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary.total).toBe(0);
    expect(confirmUploadAll).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it("leaves a local image unchanged when uploading fails", async () => {
    const view = createDrawing();
    const file = vaultFile("diagram.png");
    view.addImage("element-1", "file-1", file);
    view.selectedIds.add("element-1");
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => {
      throw new UploadError("network", "offline");
    });
    const uploader = createUploader(
      createExcalidrawApp(new FakeExcalidrawAutomate(), view),
      upload,
    );

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary.failed).toBe(1);
    expect(view.files["file-1"]).toMatchObject({ file });
    expect(view.files["file-1"]?.isHyperLink).toBeUndefined();
  });

  it("chains an existing paste hook and restores it on dispose", () => {
    const host = new FakeExcalidrawAutomate();
    const view = createDrawing();
    const previous = vi.fn(() => true);
    host.onPasteHook = previous;
    const uploader = createUploader(
      createExcalidrawApp(host, view),
      vi.fn(async () => uploadedResult),
    );

    expect(uploader.registerPasteHook()).toBe(true);
    const hook = host.onPasteHook;
    expect(hook).toBeTypeOf("function");
    expect(
      hook?.({
        ea: host,
        payload: {},
        event: { clipboardData: null } as ClipboardEvent,
        excalidrawFile: view.file,
        view,
        pointerPosition: { x: 0, y: 0 },
      }),
    ).toBe(true);
    expect(previous).toHaveBeenCalledOnce();

    uploader.dispose();
    expect(host.onPasteHook).toBe(previous);
  });

  it("lets native image paste happen, then uploads the new local element", async () => {
    vi.useFakeTimers();
    const view = createDrawing();
    view.addImage("element-1", "file-1", vaultFile("existing.png"));
    const host = new FakeExcalidrawAutomate();
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    const uploader = createUploader(createExcalidrawApp(host, view), upload);

    expect(uploader.registerPasteHook()).toBe(true);
    expect(pasteImage(host, view, "element-2", "file-2")).toBe(true);
    await vi.runAllTimersAsync();

    expect(upload).toHaveBeenCalledOnce();
    expect(view.files["file-2"]).toMatchObject({
      file: null,
      isHyperLink: true,
      hyperlink: uploadedResult.url,
    });
    expect(view.files["file-1"]?.isHyperLink).toBeUndefined();
  });

  it("does not copy images from one drawing into another", async () => {
    vi.useFakeTimers();
    const first = createDrawing("First.excalidraw.md");
    const second = createDrawing("Second.excalidraw.md");
    const host = new FakeExcalidrawAutomate();
    const uploader = createUploader(
      createExcalidrawApp(host, first),
      vi.fn(async () => uploadedResult),
    );
    uploader.registerPasteHook();

    pasteImage(host, first, "first-image", "file-1");
    await vi.runAllTimersAsync();
    first.edit("first-image", { x: 300 });
    pasteImage(host, second, "second-image", "file-2");
    await vi.runAllTimersAsync();

    expect(second.elements.map((element) => element.id)).toEqual(["second-image"]);
    expect(first.element("first-image")?.x).toBe(300);
  });

  it("does not run when the Excalidraw plugin is unavailable", async () => {
    const view = createDrawing();
    view.addImage("element-1", "file-1", vaultFile("diagram.png"));
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    const uploader = createUploader(createExcalidrawApp(undefined, view), upload);

    expect(uploader.canRun()).toBe(false);
    await expect(uploader.uploadCurrentDrawing()).resolves.toMatchObject({
      total: 0,
      uploaded: 0,
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
