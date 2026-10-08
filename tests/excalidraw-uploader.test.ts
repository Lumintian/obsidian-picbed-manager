import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { UploadError } from "../src/domain/errors";
import type { ProviderAdapter } from "../src/domain/provider";
import {
  ExcalidrawUploader,
  type ExcalidrawUploadSummary,
} from "../src/integrations/excalidraw-uploader";
import type {
  ExcalidrawAutomateLike,
  ExcalidrawElementLike,
} from "../src/references/excalidraw-adapter";
import { cloneDefaultProfile } from "../src/settings/model";

const file = {
  name: "diagram.png",
  extension: "png",
  path: "attachments/diagram.png",
} as TFile;

function configuredProfile() {
  const profile = cloneDefaultProfile();
  profile.endpoint = "https://api.test/upload";
  return profile;
}

function createApp(
  automate: ExcalidrawAutomateLike,
  vaultReadBinary: ReturnType<typeof vi.fn> = vi.fn(async () => new ArrayBuffer(2)),
): App {
  return {
    workspace: {
      activeLeaf: {
        view: {
          getViewType: () => "Excalidraw",
          file,
        },
      },
    },
    vault: { readBinary: vaultReadBinary },
    plugins: {
      plugins: {
        "obsidian-excalidraw-plugin": { getAPI: () => automate },
      },
    },
  } as unknown as App;
}

function createAutomate(
  element: ExcalidrawElementLike & { fileId: string },
  fileForElement: TFile | null = file,
): ExcalidrawAutomateLike {
  return {
    setView: vi.fn(),
    getViewSelectedElements: vi.fn(() => [element]),
    getViewElements: vi.fn(() => [element]),
    getViewFileForImageElement: vi.fn(() => fileForElement),
    copyViewElementsToEAforEditing: vi.fn(),
    getElement: vi.fn(() => element),
    imagesDict: {
      [element.fileId]: {
        id: element.fileId,
        file: fileForElement,
      },
    },
    addElementsToView: vi.fn(async () => true),
  };
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

const uploadedResult = {
  url: "https://img.test/diagram.png",
  profileId: "default",
  uploadedAt: "2026-07-18T00:00:00.000Z",
};

describe("ExcalidrawUploader", () => {
  it("uploads a selected local image and commits its remote hyperlink", async () => {
    const element = { id: "element-1", type: "image", fileId: "file-1" };
    const automate = createAutomate(element);
    const upload = vi.fn<ProviderAdapter["upload"]>(async (source) => {
      expect(source.origin).toBe("excalidraw");
      expect(source.fileName).toBe("diagram.png");
      expect(source.mimeType).toBe("image/png");
      return uploadedResult;
    });
    const uploader = createUploader(createApp(automate), upload);

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary).toEqual<ExcalidrawUploadSummary>({
      total: 1,
      uploaded: 1,
      skipped: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(automate.setView).toHaveBeenCalledOnce();
    expect(automate.copyViewElementsToEAforEditing).toHaveBeenCalledWith(
      [element],
      true,
    );
    expect(automate.imagesDict["file-1"]).toMatchObject({
      file: null,
      isHyperLink: true,
      hyperlink: uploadedResult.url,
    });
  });

  it("asks before uploading all images when no image is selected", async () => {
    const element = { id: "element-1", type: "image", fileId: "file-1" };
    const automate = createAutomate(element);
    automate.getViewSelectedElements = vi.fn(() => []);
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    const confirmUploadAll = vi.fn(() => false);
    const uploader = createUploader(createApp(automate), upload, {
      confirmUploadAll,
    });

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary.total).toBe(0);
    expect(confirmUploadAll).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it("leaves a local image unchanged when uploading fails", async () => {
    const element = { id: "element-1", type: "image", fileId: "file-1" };
    const automate = createAutomate(element);
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => {
      throw new UploadError("network", "offline");
    });
    const uploader = createUploader(createApp(automate), upload);

    const summary = await uploader.uploadCurrentDrawing();

    expect(summary.failed).toBe(1);
    expect(automate.imagesDict["file-1"]).toMatchObject({ file });
    expect(automate.imagesDict["file-1"]).not.toHaveProperty("isHyperLink");
    expect(automate.imagesDict["file-1"]).not.toHaveProperty("hyperlink");
    expect(automate.addElementsToView).not.toHaveBeenCalled();
  });

  it("chains an existing paste hook and restores it on dispose", () => {
    const element = { id: "element-1", type: "image", fileId: "file-1" };
    const automate = createAutomate(element);
    const previous = vi.fn(() => true);
    automate.onPasteHook = previous;
    const uploader = createUploader(createApp(automate), vi.fn(async () => uploadedResult));

    expect(uploader.registerPasteHook()).toBe(true);
    const hook = automate.onPasteHook;
    expect(hook).toBeTypeOf("function");
    expect(
      hook?.({
        ea: automate,
        payload: {},
        event: { clipboardData: null } as ClipboardEvent,
        excalidrawFile: file,
        view: {},
        pointerPosition: { x: 0, y: 0 },
      }),
    ).toBe(true);
    expect(previous).toHaveBeenCalledOnce();

    uploader.dispose();
    expect(automate.onPasteHook).toBe(previous);
  });

  it("lets native image paste happen, then uploads the new local element", async () => {
    vi.useFakeTimers();
    try {
      const oldElement = { id: "element-1", type: "image", fileId: "file-1" };
      const newElement = { id: "element-2", type: "image", fileId: "file-2" };
      const elements = [oldElement] as (typeof oldElement | typeof newElement)[];
      const automate = createAutomate(oldElement);
      automate.getViewElements = vi.fn(() => elements);
      automate.getElement = vi.fn((id) => elements.find((element) => element.id === id));
      automate.getViewFileForImageElement = vi.fn(() => file);
      automate.imagesDict["file-2"] = {
        id: "file-2",
        file,
      };
      const clipboardFile = { name: "pasted.png", type: "image/png" } as File;
      const clipboardData = {
        files: { length: 1, item: () => clipboardFile },
      } as unknown as DataTransfer;
      const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
      const uploader = createUploader(createApp(automate), upload);

      expect(uploader.registerPasteHook()).toBe(true);
      const result = automate.onPasteHook?.({
        ea: automate,
        payload: {},
        event: { clipboardData } as ClipboardEvent,
        excalidrawFile: file,
        view: {},
        pointerPosition: { x: 0, y: 0 },
      });
      expect(result).toBe(true);

      // This represents Excalidraw's native paste completing after the hook.
      elements.push(newElement);
      await vi.runOnlyPendingTimersAsync();

      expect(upload).toHaveBeenCalledOnce();
      expect(automate.imagesDict["file-2"]).toMatchObject({
        file: null,
        isHyperLink: true,
        hyperlink: uploadedResult.url,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not run when the Excalidraw plugin is unavailable", async () => {
    const element = { id: "element-1", type: "image", fileId: "file-1" };
    const automate = createAutomate(element);
    const app = createApp(automate);
    (app as unknown as { plugins: undefined }).plugins = undefined;
    const upload = vi.fn<ProviderAdapter["upload"]>(async () => uploadedResult);
    const uploader = createUploader(app, upload);

    expect(uploader.canRun()).toBe(false);
    await expect(uploader.uploadCurrentDrawing()).resolves.toMatchObject({
      total: 0,
      uploaded: 0,
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
