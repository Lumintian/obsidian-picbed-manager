import type { TFile } from "obsidian";
import type { AssetResult } from "../domain/asset";
import { UploadError } from "../domain/errors";
import type { ReferenceAdapter, ReferenceAnchor } from "../domain/reference";

/** The part of an Excalidraw element needed by the integration. */
export interface ExcalidrawElementLike {
  id: string;
  type: string;
  fileId?: string | null;
  isDeleted?: boolean;
}

/** A mutable element staged on an ExcalidrawAutomate workbench. */
export interface ExcalidrawWorkbenchElementLike extends ExcalidrawElementLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The public image workbench shape exposed by ExcalidrawAutomate. */
export interface ExcalidrawImageInfoLike {
  id?: string;
  file?: unknown | null;
  isHyperLink?: boolean;
  hyperlink?: string;
  [key: string]: unknown;
}

export interface ExcalidrawPasteHookData {
  ea: ExcalidrawAutomateLike;
  payload: unknown;
  event: ClipboardEvent;
  excalidrawFile: TFile;
  view: unknown;
  pointerPosition: { x: number; y: number };
}

export type ExcalidrawPasteHook = (
  data: ExcalidrawPasteHookData,
) => boolean | void;

/** The public ExcalidrawAutomate methods used by Picbed Manager. */
export interface ExcalidrawAutomateLike {
  onPasteHook?: ExcalidrawPasteHook | null;
  /** Creates a new instance with its own empty workbench, bound to `view`. */
  getAPI(view?: unknown): ExcalidrawAutomateLike;
  getViewSelectedElements(includeFrameChildren?: boolean): readonly ExcalidrawElementLike[];
  getViewElements(): readonly ExcalidrawElementLike[];
  getViewFileForImageElement(
    element: ExcalidrawElementLike,
  ): TFile | null | undefined;
  copyViewElementsToEAforEditing(
    elements: readonly ExcalidrawElementLike[],
    copyImages?: boolean,
  ): void;
  /** Stages an image; `imageFile` may be a data URL. Resolves to its element ID. */
  addImage(topX: number, topY: number, imageFile: string): Promise<string | null>;
  /** Returns a staged element from this instance's workbench, not the scene. */
  getElement(id: string): ExcalidrawWorkbenchElementLike | undefined;
  imagesDict: Record<string, ExcalidrawImageInfoLike>;
  addElementsToView(
    repositionToCursor?: boolean,
    save?: boolean,
    newElementsOnTop?: boolean,
  ): Promise<boolean>;
  clear(): void;
  destroy?(): void;
}

export interface ExcalidrawReferenceContext {
  /** Any ExcalidrawAutomate instance; only used to open private workbenches. */
  host: ExcalidrawAutomateLike;
  /** The Excalidraw view that owns the image. */
  view: unknown;
  elementId: string;
  fileId: string;
}

/**
 * Runs a read-only query on a short-lived ExcalidrawAutomate bound to `view`.
 */
export function queryDrawing<T>(
  host: ExcalidrawAutomateLike,
  view: unknown,
  query: (automate: ExcalidrawAutomateLike) => T,
): T {
  const automate = host.getAPI(view);
  try {
    return query(automate);
  } finally {
    releaseAutomate(automate);
  }
}

/**
 * Adds an image from a data URL to the drawing, centered on `position`, and
 * returns the new element. The drawing is only
 * marked as changed, not saved, so Excalidraw does not write the image to the
 * vault before Picbed has had a chance to switch it to a hosted link.
 */
export async function insertImage(
  host: ExcalidrawAutomateLike,
  view: unknown,
  dataURL: string,
  position: { x: number; y: number },
): Promise<ExcalidrawElementLike & { fileId: string }> {
  const automate = host.getAPI(view);
  try {
    const id = await automate.addImage(0, 0, dataURL);
    const element = id ? automate.getElement(id) : undefined;
    if (!id || !element || !isExcalidrawImageElement(element)) {
      throw new Error("Excalidraw could not read the pasted image.");
    }
    element.x = position.x - element.width / 2;
    element.y = position.y - element.height / 2;
    if (!(await automate.addElementsToView(false, false, true))) {
      throw new Error("Excalidraw could not add the pasted image.");
    }
    return { id, type: "image", fileId: element.fileId };
  } finally {
    releaseAutomate(automate);
  }
}

function releaseAutomate(automate: ExcalidrawAutomateLike): void {
  automate.clear();
  automate.destroy?.();
}

/**
 * Converts an Excalidraw image workbench entry from a vault file to an
 * external hyperlink while preserving its file id and other image metadata.
 */
export function asExternalImageInfo(
  info: ExcalidrawImageInfoLike,
  fileId: string,
  url: string,
): ExcalidrawImageInfoLike {
  return {
    ...info,
    id: info.id ?? fileId,
    file: null,
    isHyperLink: true,
    hyperlink: url,
  };
}

/**
 * Commits an uploaded image through ExcalidrawAutomate's workbench API.
 * The plugin-global ExcalidrawAutomate is shared with Excalidraw scripts and
 * `addElementsToView` writes back everything staged on a workbench, so every
 * commit stages only its own image on a private instance. The image is copied
 * from the live scene right before committing, which keeps edits made while
 * the upload was running and leaves images deleted in the meantime deleted.
 */
export class ExcalidrawReferenceAdapter
  implements ReferenceAdapter<ExcalidrawReferenceContext>
{
  insertPending(context: ExcalidrawReferenceContext): ReferenceAnchor {
    return { token: context.elementId };
  }

  async commit(
    context: ExcalidrawReferenceContext,
    anchor: ReferenceAnchor,
    result: AssetResult,
  ): Promise<void> {
    const automate = context.host.getAPI(context.view);
    try {
      const element = automate
        .getViewElements()
        .find((candidate) => candidate.id === anchor.token);
      if (
        !element ||
        element.isDeleted ||
        element.type !== "image" ||
        element.fileId !== context.fileId
      ) {
        throw new UploadError(
          "reference-conflict",
          "The Excalidraw image was edited, removed, or closed before the upload finished.",
        );
      }

      try {
        automate.copyViewElementsToEAforEditing([element], true);
      } catch (error) {
        throw new UploadError(
          "reference-conflict",
          "The Excalidraw image data is no longer available.",
          { cause: error },
        );
      }
      const imageInfo = automate.imagesDict[context.fileId];
      if (!imageInfo) {
        throw new UploadError(
          "reference-conflict",
          "The Excalidraw image data is no longer available.",
        );
      }

      automate.imagesDict[context.fileId] = asExternalImageInfo(
        imageInfo,
        context.fileId,
        result.url,
      );
      const saved = await automate.addElementsToView(false, true);
      if (!saved) {
        throw new UploadError(
          "reference-conflict",
          "Excalidraw could not save the uploaded image reference.",
        );
      }
    } finally {
      releaseAutomate(automate);
    }
  }

  async fail(): Promise<void> {
    // Keep the local image untouched so a failed upload can be retried.
  }
}

export function isExcalidrawImageElement(
  value: unknown,
): value is ExcalidrawElementLike & { fileId: string } {
  if (typeof value !== "object" || value === null) return false;
  const element = value as ExcalidrawElementLike;
  return (
    typeof element.id === "string" &&
    element.type === "image" &&
    typeof element.fileId === "string" &&
    element.fileId.length > 0
  );
}
