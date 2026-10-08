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
    autoUploadOnPaste: () => boolean;
  }> = {},
): ExcalidrawUploader {
  return new ExcalidrawUploader(
    app,
    { kind: "custom-api", upload },
    {
      getProfile: configuredProfile,
      getRetryCount: () => 0,
      autoUploadOnPaste: overrides.autoUploadOnPaste,
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

const clipboardBytes = new Uint8Array([7, 8, 9]).buffer;
const clipboardDataURL = "data:image/png;base64,BwgJ";

function clipboardImage(): File {
  return {
    name: "pasted.png",
    type: "image/png",
    arrayBuffer: async () => clipboardBytes,
  } as File;
}

/** Calls the paste hook the way Excalidraw does for a paste at `pointer`. */
function paste(
  host: FakeExcalidrawAutomate,
  view: FakeExcalidrawView,
  {
    pointer = { x: 0, y: 0 },
    files = [clipboardImage()],
  }: { pointer?: { x: number; y: number }; files?: File[] } = {},
): boolean | void {
  const clipboardData = {
    files: { length: files.length, item: (index: number) => files[index] ?? null },
  } as unknown as DataTransfer;
  return host.onPasteHook?.({
    ea: host,
    payload: {},
    event: { clipboardData } as ClipboardEvent,
    excalidrawFile: view.file,
    view,
    pointerPosition: pointer,
  });
}

/** The images Picbed inserted into `view` for pastes. */
function pastedImages(view: FakeExcalidrawView) {
  return view.elements.filter((element) => element.id.includes("-pasted-"));
}

/** Lets pending paste and upload work run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resolves each upload only when the test releases it. */
function createControlledUpload() {
  const pending: (() => void)[] = [];
  let active = 0;
  let maxActive = 0;
  const upload = vi.fn<ProviderAdapter["upload"]>(
    () =>
      new Promise((resolve) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        pending.push(() => {
          active -= 1;
          resolve(uploadedResult);
        });
      }),
  );
  return {
    upload,
    maxActive: () => maxActive,
    releaseNext: async () => {
      pending.shift()?.();
      await settle();
    },
  };
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

  it("skips embedded notes, PDF pages, and nested drawings", async () => {
    const view = createDrawing();
    view.addImage("image", "file-1", vaultFile("diagram.png"));
    view.addImage("note", "file-2", vaultFile("Meeting notes.md"));
    view.addImage("pdf", "file-3", vaultFile("Paper.pdf"));
    view.addImage("drawing", "file-4", vaultFile("Sketch.excalidraw.md"));
    const notify = vi.fn();
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    const uploader = createUploader(
      createExcalidrawApp(new FakeExcalidrawAutomate(), view),
      upload,
      { notify, confirmUploadAll: () => true },
    );

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary).toMatchObject({ total: 4, uploaded: 1, skipped: 3 });
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0]?.[0].fileName).toBe("diagram.png");
    expect(view.files["file-2"]?.file).toEqual(vaultFile("Meeting notes.md"));
    expect(view.files["file-3"]?.isHyperLink).toBeUndefined();
  });

  it("reports when a selection has no uploadable images", async () => {
    const view = createDrawing();
    view.addImage("note", "file-1", vaultFile("Meeting notes.md"));
    view.selectedIds.add("note");
    const notify = vi.fn();
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    const uploader = createUploader(
      createExcalidrawApp(new FakeExcalidrawAutomate(), view),
      upload,
      { notify },
    );

    await uploader.uploadCurrentDrawing();

    expect(upload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "No local Excalidraw images are available to upload. Web links, embedded notes, and PDF pages were left unchanged.",
    );
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

  it("takes over an image paste and inserts the image at the pointer", async () => {
    const view = createDrawing();
    const host = new FakeExcalidrawAutomate();
    const upload = vi.fn<ProviderAdapter["upload"]>(async (source) => {
      expect(source).toMatchObject({
        fileName: "pasted.png",
        mimeType: "image/png",
        bytes: clipboardBytes,
        origin: "excalidraw",
      });
      return uploadedResult;
    });
    const uploader = createUploader(createExcalidrawApp(host, view), upload);
    uploader.registerPasteHook();

    expect(paste(host, view, { pointer: { x: 400, y: 300 } })).toBe(false);
    await settle();

    const [image] = pastedImages(view);
    expect(image).toMatchObject({ x: 300, y: 250, width: 200, height: 100 });
    expect(view.files[image?.fileId ?? ""]).toMatchObject({
      dataURL: clipboardDataURL,
      file: null,
      isHyperLink: true,
      hyperlink: uploadedResult.url,
    });
    expect(upload).toHaveBeenCalledOnce();
    // Inserting must not save, or Excalidraw would write a local copy first.
    expect(view.saveRequests[0]).toBe(false);
  });

  it("shows the pasted image at once and keeps edits made while it uploads", async () => {
    const view = createDrawing();
    const host = new FakeExcalidrawAutomate();
    const controlled = createControlledUpload();
    const uploader = createUploader(
      createExcalidrawApp(host, view),
      controlled.upload,
    );
    uploader.registerPasteHook();

    paste(host, view);
    await settle();
    const [image] = pastedImages(view);
    expect(image).toBeDefined();
    expect(view.files[image?.fileId ?? ""]?.isHyperLink).toBe(false);
    view.edit(image?.id ?? "", { x: 900 });
    await controlled.releaseNext();

    expect(view.element(image?.id ?? "")?.x).toBe(900);
    expect(view.files[image?.fileId ?? ""]?.hyperlink).toBe(uploadedResult.url);
  });

  it("keeps the pasted image as a local image when the upload fails", async () => {
    const view = createDrawing();
    const host = new FakeExcalidrawAutomate();
    const notify = vi.fn();
    const uploader = createUploader(
      createExcalidrawApp(host, view),
      vi.fn(async () => {
        throw new UploadError("network", "offline");
      }),
      { notify },
    );
    uploader.registerPasteHook();

    paste(host, view);
    await settle();

    const [image] = pastedImages(view);
    expect(view.files[image?.fileId ?? ""]).toMatchObject({
      dataURL: clipboardDataURL,
      file: null,
      isHyperLink: false,
    });
    expect(notify).toHaveBeenCalledWith(
      "Excalidraw image upload failed for pasted.png: offline",
    );
  });

  it("uploads every image pasted while another upload is running", async () => {
    const view = createDrawing();
    const host = new FakeExcalidrawAutomate();
    const controlled = createControlledUpload();
    const uploader = createUploader(
      createExcalidrawApp(host, view),
      controlled.upload,
    );
    uploader.registerPasteHook();

    paste(host, view, { pointer: { x: 0, y: 0 } });
    paste(host, view, { pointer: { x: 500, y: 0 } });
    await settle();
    expect(pastedImages(view)).toHaveLength(2);
    await controlled.releaseNext();
    await controlled.releaseNext();

    expect(controlled.upload).toHaveBeenCalledTimes(2);
    expect(controlled.maxActive()).toBe(1);
    for (const image of pastedImages(view)) {
      expect(view.files[image.fileId]?.hyperlink).toBe(uploadedResult.url);
    }
  });

  it("queues the upload command behind a running paste upload", async () => {
    const view = createDrawing();
    view.addImage("existing", "file-0", vaultFile("existing.png"));
    view.selectedIds.add("existing");
    const host = new FakeExcalidrawAutomate();
    const controlled = createControlledUpload();
    const uploader = createUploader(
      createExcalidrawApp(host, view),
      controlled.upload,
    );
    uploader.registerPasteHook();

    paste(host, view);
    await settle();
    const command = uploader.uploadCurrentDrawing();
    await settle();
    expect(controlled.upload).toHaveBeenCalledOnce();
    await controlled.releaseNext();
    await controlled.releaseNext();

    await expect(command).resolves.toMatchObject({ total: 1, uploaded: 1 });
    expect(controlled.maxActive()).toBe(1);
    expect(view.files["file-0"]?.isHyperLink).toBe(true);
  });

  it("leaves other pastes to Excalidraw", async () => {
    const view = createDrawing();
    const host = new FakeExcalidrawAutomate();
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    let autoUpload = true;
    const uploader = createUploader(createExcalidrawApp(host, view), upload, {
      autoUploadOnPaste: () => autoUpload,
    });
    uploader.registerPasteHook();

    expect(paste(host, view, { files: [clipboardImage(), clipboardImage()] })).toBe(true);
    expect(
      paste(host, view, { files: [{ name: "a.txt", type: "text/plain" } as File] }),
    ).toBe(true);
    autoUpload = false;
    expect(paste(host, view)).toBe(true);
    await settle();

    expect(pastedImages(view)).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports a paste that could not be inserted", async () => {
    const view = createDrawing();
    view.saveSucceeds = false;
    const host = new FakeExcalidrawAutomate();
    const notify = vi.fn();
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    const uploader = createUploader(createExcalidrawApp(host, view), upload, {
      notify,
    });
    uploader.registerPasteHook();

    paste(host, view);
    await settle();

    expect(notify).toHaveBeenCalledWith(
      "Could not paste the image into Excalidraw: Excalidraw could not add the pasted image.",
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not copy images from one drawing into another", async () => {
    const first = createDrawing("First.excalidraw.md");
    const second = createDrawing("Second.excalidraw.md");
    const host = new FakeExcalidrawAutomate();
    const uploader = createUploader(
      createExcalidrawApp(host, first),
      vi.fn(async () => uploadedResult),
    );
    uploader.registerPasteHook();

    paste(host, first);
    await settle();
    const [firstImage] = pastedImages(first);
    first.edit(firstImage?.id ?? "", { x: 300 });
    paste(host, second);
    await settle();

    expect(second.elements).toHaveLength(1);
    expect(first.elements).toHaveLength(1);
    expect(first.element(firstImage?.id ?? "")?.x).toBe(300);
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
