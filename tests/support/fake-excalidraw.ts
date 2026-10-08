import type { App, TFile } from "obsidian";
import { vi } from "vitest";
import type {
  ExcalidrawAutomateLike,
  ExcalidrawElementLike,
  ExcalidrawImageInfoLike,
  ExcalidrawPasteHook,
  ExcalidrawWorkbenchElementLike,
} from "../../src/references/excalidraw-adapter";

export interface FakeImageElement extends ExcalidrawWorkbenchElementLike {
  type: "image";
  fileId: string;
  isDeleted?: boolean;
}

/** The size the fake gives every image added with `addImage`. */
export const FAKE_IMAGE_SIZE = { width: 200, height: 100 };

// Shared by all instances: like Excalidraw's nanoid IDs, IDs never repeat.
let addedImages = 0;

/** The scene's binary data for a file id plus Excalidraw's link for it. */
export interface FakeDrawingFile {
  mimeType: string;
  dataURL: string;
  file: TFile | null;
  isHyperLink?: boolean;
  hyperlink?: string;
}

/**
 * An open Excalidraw drawing. Like the real scene, elements are replaced
 * rather than mutated when they change.
 */
export class FakeExcalidrawView {
  elements: FakeImageElement[] = [];
  files: Record<string, FakeDrawingFile> = {};
  selectedIds = new Set<string>();
  loaded = true;
  saveSucceeds = true;
  /** Whether each `addElementsToView` call asked Excalidraw to save. */
  readonly saveRequests: boolean[] = [];

  constructor(readonly file: TFile) {}

  getViewType(): string {
    return "excalidraw";
  }

  addImage(id: string, fileId: string, file: TFile | null): FakeImageElement {
    const element: FakeImageElement = {
      id,
      type: "image",
      fileId,
      x: 0,
      y: 0,
      ...FAKE_IMAGE_SIZE,
    };
    this.elements = [...this.elements, element];
    this.files[fileId] ??= {
      mimeType: "image/png",
      dataURL: `data:image/png;base64,${fileId}`,
      file,
    };
    return element;
  }

  element(id: string): FakeImageElement | undefined {
    return this.elements.find((element) => element.id === id);
  }

  /** Applies a user edit the way Excalidraw does, by replacing the element. */
  edit(id: string, changes: Partial<FakeImageElement>): void {
    this.elements = this.elements.map((element) =>
      element.id === id ? { ...element, ...changes } : element,
    );
  }
}

/**
 * Follows the ExcalidrawAutomate behavior Picbed depends on: `getAPI()` makes
 * a new instance with its own workbench, `copyViewElementsToEAforEditing()`
 * stages copies of scene elements, and `addElementsToView()` writes every
 * staged element back to the scene without clearing the workbench.
 */
export class FakeExcalidrawAutomate implements ExcalidrawAutomateLike {
  onPasteHook: ExcalidrawPasteHook | null = null;
  elementsDict: Record<string, FakeImageElement> = {};
  imagesDict: Record<string, ExcalidrawImageInfoLike> = {};
  destroyed = false;

  constructor(
    public targetView?: FakeExcalidrawView,
    readonly instances: FakeExcalidrawAutomate[] = [],
  ) {}

  getAPI(view?: unknown): FakeExcalidrawAutomate {
    const automate = new FakeExcalidrawAutomate(
      view as FakeExcalidrawView | undefined,
      this.instances,
    );
    this.instances.push(automate);
    return automate;
  }

  getViewElements(): readonly FakeImageElement[] {
    return this.readyView()?.elements.filter((element) => !element.isDeleted) ?? [];
  }

  getViewSelectedElements(): readonly FakeImageElement[] {
    const selectedIds = this.readyView()?.selectedIds;
    return this.getViewElements().filter((element) => selectedIds?.has(element.id));
  }

  getViewFileForImageElement(element: ExcalidrawElementLike): TFile | null {
    const fileId = (element as FakeImageElement).fileId;
    return this.readyView()?.files[fileId]?.file ?? null;
  }

  copyViewElementsToEAforEditing(
    elements: readonly ExcalidrawElementLike[],
    copyImages = false,
  ): void {
    const view = this.readyView();
    if (copyImages && !view) return;
    for (const element of elements as readonly FakeImageElement[]) {
      this.elementsDict[element.id] = { ...element };
      if (!copyImages || !view) continue;
      const sceneFile = view.files[element.fileId];
      if (!sceneFile) {
        throw new TypeError("Cannot read properties of undefined (reading 'mimeType')");
      }
      this.imagesDict[element.fileId] = {
        id: element.fileId,
        mimeType: sceneFile.mimeType,
        dataURL: sceneFile.dataURL,
        file: sceneFile.file,
        isHyperLink: sceneFile.isHyperLink ?? false,
        hyperlink: sceneFile.hyperlink,
      };
    }
  }

  /** Like the real method, accepts a data URL and stages a new image for it. */
  async addImage(
    topX: number,
    topY: number,
    imageFile: string,
  ): Promise<string | null> {
    if (!imageFile.startsWith("data:image/")) return null;
    addedImages += 1;
    const id = `${this.targetView?.file.name ?? "drawing"}-pasted-${addedImages}`;
    const fileId = `file-${id}`;
    this.imagesDict[fileId] = {
      id: fileId,
      mimeType: imageFile.slice("data:".length, imageFile.indexOf(";")),
      dataURL: imageFile,
      file: null,
      isHyperLink: false,
      hyperlink: undefined,
    };
    this.elementsDict[id] = {
      id,
      type: "image",
      fileId,
      x: topX,
      y: topY,
      ...FAKE_IMAGE_SIZE,
    };
    return id;
  }

  getElement(id: string): FakeImageElement | undefined {
    return this.elementsDict[id];
  }

  async addElementsToView(
    ...[, save = true, newElementsOnTop = false]: [
      repositionToCursor?: boolean,
      save?: boolean,
      newElementsOnTop?: boolean,
    ]
  ): Promise<boolean> {
    const view = this.readyView();
    if (!view?.saveSucceeds) return false;
    view.saveRequests.push(save);
    const staged = Object.values(this.elementsDict);
    const sceneIds = new Set(view.elements.map((element) => element.id));
    const inserted = staged.filter((element) => !sceneIds.has(element.id));
    const updated = view.elements.map(
      (element) => this.elementsDict[element.id] ?? element,
    );
    view.elements = (
      newElementsOnTop ? [...updated, ...inserted] : [...inserted, ...updated]
    ).map((element) => ({ ...element }));
    for (const [fileId, info] of Object.entries(this.imagesDict)) {
      view.files[fileId] = {
        mimeType: String(info.mimeType),
        dataURL: String(info.dataURL),
        file: info.isHyperLink ? null : ((info.file as TFile | null) ?? null),
        isHyperLink: info.isHyperLink === true,
        hyperlink: info.isHyperLink ? String(info.hyperlink) : undefined,
      };
    }
    return true;
  }

  clear(): void {
    this.elementsDict = {};
    this.imagesDict = {};
  }

  destroy(): void {
    this.clear();
    this.destroyed = true;
  }

  private readyView(): FakeExcalidrawView | undefined {
    return this.targetView?.loaded ? this.targetView : undefined;
  }
}

export function createExcalidrawApp(
  host: FakeExcalidrawAutomate | undefined,
  activeView: FakeExcalidrawView | undefined,
  readBinary: (file: TFile) => Promise<ArrayBuffer> = vi.fn(
    async () => new ArrayBuffer(2),
  ),
): App {
  return {
    workspace: { activeLeaf: activeView ? { view: activeView } : null },
    vault: { readBinary },
    plugins: {
      plugins: host ? { "obsidian-excalidraw-plugin": { ea: host } } : {},
    },
  } as unknown as App;
}

export function vaultFile(name: string): TFile {
  const extension = name.split(".").pop() ?? "";
  return { name, extension, path: `attachments/${name}` } as TFile;
}
