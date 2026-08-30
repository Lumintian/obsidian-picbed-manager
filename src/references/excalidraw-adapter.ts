import type { TFile } from "obsidian";
import type { AssetResult } from "../domain/asset";
import { UploadError } from "../domain/errors";
import type { ReferenceAdapter, ReferenceAnchor } from "../domain/reference";

/** The part of an Excalidraw element needed by the integration. */
export interface ExcalidrawElementLike {
  id: string;
  type: string;
  fileId?: string | null;
}

/** The public image workbench shape exposed by ExcalidrawAutomate. */
export interface ExcalidrawImageInfoLike {
  id?: string;
  file?: unknown | null;
  isHyperLink?: boolean;
  hyperlink?: string;
  [key: string]: unknown;
}

/** The public ExcalidrawAutomate methods used by Picbed Manager. */
export interface ExcalidrawAutomateLike {
  setView(view: unknown): unknown;
  getViewSelectedElements(includeFrameChildren?: boolean): readonly ExcalidrawElementLike[];
  getViewElements(): readonly ExcalidrawElementLike[];
  getViewFileForImageElement(
    element: ExcalidrawElementLike,
  ): TFile | null | undefined;
  copyViewElementsToEAforEditing(
    elements: readonly ExcalidrawElementLike[],
    copyImages?: boolean,
  ): void;
  getElement(id: string): ExcalidrawElementLike | null | undefined;
  imagesDict: Record<string, ExcalidrawImageInfoLike>;
  addElementsToView(
    repositionToCursor?: boolean,
    save?: boolean,
  ): Promise<boolean>;
}

export interface ExcalidrawReferenceContext {
  automate: ExcalidrawAutomateLike;
  elementId: string;
  fileId: string;
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
 * Excalidraw scene elements are immutable, so the image metadata is changed
 * in `imagesDict` and then committed with `addElementsToView`.
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
    const element = context.automate.getElement(anchor.token);
    if (
      !element ||
      element.type !== "image" ||
      element.fileId !== context.fileId
    ) {
      throw new UploadError(
        "reference-conflict",
        "The Excalidraw image was edited or removed before the upload finished.",
      );
    }

    const imageInfo = context.automate.imagesDict[context.fileId];
    if (!imageInfo) {
      throw new UploadError(
        "reference-conflict",
        "The Excalidraw image data is no longer available.",
      );
    }

    context.automate.imagesDict[context.fileId] = asExternalImageInfo(
      imageInfo,
      context.fileId,
      result.url,
    );
    const saved = await context.automate.addElementsToView(false, true);
    if (!saved) {
      throw new UploadError(
        "reference-conflict",
        "Excalidraw could not save the uploaded image reference.",
      );
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
