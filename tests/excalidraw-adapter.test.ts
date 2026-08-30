import { describe, expect, it, vi } from "vitest";
import {
  asExternalImageInfo,
  ExcalidrawReferenceAdapter,
  type ExcalidrawAutomateLike,
} from "../src/references/excalidraw-adapter";

function createAutomate(saved = true): ExcalidrawAutomateLike {
  const element = { id: "element-1", type: "image", fileId: "file-1" };
  return {
    setView: () => undefined,
    getViewSelectedElements: () => [element],
    getViewElements: () => [element],
    getViewFileForImageElement: () => null,
    copyViewElementsToEAforEditing: () => undefined,
    getElement: () => element,
    imagesDict: {
      "file-1": {
        id: "file-1",
        file: { path: "attachments/image.png" },
        dataURL: "data:image/png;base64,old",
      },
    },
    addElementsToView: vi.fn(async () => saved),
  };
}

describe("ExcalidrawReferenceAdapter", () => {
  it("preserves image metadata while converting a local file to a hyperlink", async () => {
    const automate = createAutomate();
    const adapter = new ExcalidrawReferenceAdapter();
    const context = { automate, elementId: "element-1", fileId: "file-1" };
    const anchor = adapter.insertPending(context);

    await adapter.commit(context, anchor, {
      url: "https://img.test/image.png",
      profileId: "default",
      uploadedAt: "2026-07-18T00:00:00.000Z",
    });

    expect(automate.imagesDict["file-1"]).toMatchObject({
      id: "file-1",
      file: null,
      isHyperLink: true,
      hyperlink: "https://img.test/image.png",
      dataURL: "data:image/png;base64,old",
    });
    expect(automate.addElementsToView).toHaveBeenCalledWith(false, true);
  });

  it("reports a reference conflict when Excalidraw refuses to save", async () => {
    const automate = createAutomate(false);
    const adapter = new ExcalidrawReferenceAdapter();
    const context = { automate, elementId: "element-1", fileId: "file-1" };

    await expect(
      adapter.commit(context, adapter.insertPending(context), {
        url: "https://img.test/image.png",
        profileId: "default",
        uploadedAt: "2026-07-18T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "reference-conflict",
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
