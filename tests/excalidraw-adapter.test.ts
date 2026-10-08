import { describe, expect, it } from "vitest";
import {
  asExternalImageInfo,
  ExcalidrawReferenceAdapter,
  type ExcalidrawReferenceContext,
} from "../src/references/excalidraw-adapter";
import {
  FakeExcalidrawAutomate,
  FakeExcalidrawView,
  vaultFile,
} from "./support/fake-excalidraw";

const uploaded = {
  url: "https://img.test/image.png",
  profileId: "default",
  uploadedAt: "2026-07-18T00:00:00.000Z",
};

function createDrawing() {
  const view = new FakeExcalidrawView(vaultFile("Drawing.excalidraw.md"));
  view.addImage("element-1", "file-1", vaultFile("image.png"));
  const host = new FakeExcalidrawAutomate();
  const context: ExcalidrawReferenceContext = {
    host,
    view,
    elementId: "element-1",
    fileId: "file-1",
  };
  return { view, host, context };
}

describe("ExcalidrawReferenceAdapter", () => {
  it("preserves image metadata while converting a local file to a hyperlink", async () => {
    const { view, context } = createDrawing();
    const adapter = new ExcalidrawReferenceAdapter();

    await adapter.commit(context, adapter.insertPending(context), uploaded);

    expect(view.files["file-1"]).toEqual({
      mimeType: "image/png",
      dataURL: "data:image/png;base64,file-1",
      file: null,
      isHyperLink: true,
      hyperlink: uploaded.url,
    });
  });

  it("commits from a private workbench and releases it", async () => {
    const { view, host, context } = createDrawing();
    view.addImage("element-2", "file-2", vaultFile("other.png"));
    const adapter = new ExcalidrawReferenceAdapter();

    await adapter.commit(context, adapter.insertPending(context), uploaded);

    expect(host.elementsDict).toEqual({});
    expect(host.instances).toHaveLength(1);
    expect(host.instances.every((instance) => instance.destroyed)).toBe(true);
    expect(view.files["file-2"]?.file).toEqual(vaultFile("other.png"));
  });

  it("keeps edits made to the image while it was uploading", async () => {
    const { view, context } = createDrawing();
    const adapter = new ExcalidrawReferenceAdapter();
    const anchor = adapter.insertPending(context);
    view.edit("element-1", { x: 500 });

    await adapter.commit(context, anchor, uploaded);

    expect(view.element("element-1")?.x).toBe(500);
  });

  it("does not restore an image deleted while it was uploading", async () => {
    const { view, context } = createDrawing();
    const adapter = new ExcalidrawReferenceAdapter();
    const anchor = adapter.insertPending(context);
    view.edit("element-1", { isDeleted: true });

    await expect(adapter.commit(context, anchor, uploaded)).rejects.toMatchObject({
      code: "reference-conflict",
    });
    expect(view.element("element-1")?.isDeleted).toBe(true);
    expect(view.files["file-1"]?.isHyperLink).toBeUndefined();
  });

  it("reports a reference conflict when Excalidraw refuses to save", async () => {
    const { view, context } = createDrawing();
    view.saveSucceeds = false;
    const adapter = new ExcalidrawReferenceAdapter();

    await expect(
      adapter.commit(context, adapter.insertPending(context), uploaded),
    ).rejects.toMatchObject({
      code: "reference-conflict",
    });
  });

  it("reports a reference conflict when the image data is missing", async () => {
    const { view, context } = createDrawing();
    delete view.files["file-1"];
    const adapter = new ExcalidrawReferenceAdapter();

    await expect(
      adapter.commit(context, adapter.insertPending(context), uploaded),
    ).rejects.toMatchObject({
      code: "reference-conflict",
      message: "The Excalidraw image data is no longer available.",
    });
  });

  it("does not mutate the original image info object", () => {
    const original = {
      id: "file-1",
      file: { path: "attachments/image.png" },
      colorMap: { red: "blue" },
    };

    expect(
      asExternalImageInfo(original, "file-1", "https://img.test/image.png"),
    ).toEqual({
      id: "file-1",
      file: null,
      isHyperLink: true,
      hyperlink: "https://img.test/image.png",
      colorMap: { red: "blue" },
    });
    expect(original.file).toEqual({ path: "attachments/image.png" });
  });
});
