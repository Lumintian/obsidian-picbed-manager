import type { App, TFile } from "obsidian";
import type { AssetSource } from "../domain/asset";
import type { ProviderAdapter } from "../domain/provider";
import { getSingleSupportedImage } from "../ingestion/paste-policy";
import type { UploadCoordinatorCallbacks } from "../operations/upload-coordinator";
import { UploadCoordinator } from "../operations/upload-coordinator";
import {
  ExcalidrawReferenceAdapter,
  insertImage,
  isExcalidrawImageElement,
  queryDrawing,
  type ExcalidrawAutomateLike,
  type ExcalidrawElementLike,
  type ExcalidrawPasteHook,
  type ExcalidrawReferenceContext,
} from "../references/excalidraw-adapter";
import { createId } from "../shared/id";
import { imageMimeTypeForExtension, toImageDataURL } from "../shared/image-types";
import type { UploadProfile } from "../settings/model";

export const EXCALIDRAW_PLUGIN_ID = "obsidian-excalidraw-plugin";

interface PluginManagerLike {
  plugins?: Record<string, unknown>;
  getPlugin?: (id: string) => unknown;
}

type AppWithPluginManager = App & {
  plugins?: PluginManagerLike;
};

interface ExcalidrawPluginLike {
  ea?: ExcalidrawAutomateLike;
}

interface ActiveExcalidrawViewLike {
  getViewType?: () => string;
  file?: TFile | null;
}

type ExcalidrawImageElementLike = ExcalidrawElementLike & { fileId: string };

interface UploadCandidate {
  element: ExcalidrawImageElementLike;
  file: TFile;
  mimeType: string;
}

interface PreparedCandidate extends UploadCandidate {
  bytes: ArrayBuffer;
}

/** The drawing an upload belongs to and the API used to reach it. */
interface DrawingTarget {
  host: ExcalidrawAutomateLike;
  view: unknown;
  notePath: string | undefined;
}

export interface ExcalidrawUploadSummary {
  total: number;
  uploaded: number;
  skipped: number;
  failed: number;
  cancelled: number;
}

export interface ExcalidrawUploaderOptions {
  getProfile(): UploadProfile | undefined;
  getRetryCount(): number;
  autoUploadOnPaste?: () => boolean;
  callbacks: UploadCoordinatorCallbacks;
  notify?: (message: string) => void;
  confirmUploadAll?: (message: string) => boolean;
}

/**
 * Integrates with Excalidraw from the outside, using its public
 * ExcalidrawAutomate API. The command uploads existing local images. The paste
 * hook takes over image pastes: it inserts the image at the pointer itself and
 * then switches it to the hosted link, so a failed upload leaves an ordinary
 * local image behind. Uploads run one at a time in request order.
 */
export class ExcalidrawUploader {
  private readonly coordinator: UploadCoordinator<ExcalidrawReferenceContext>;
  private readonly notify: (message: string) => void;
  private readonly confirmUploadAll: (message: string) => boolean;
  private queue: Promise<void> = Promise.resolve();
  private hookHost: ExcalidrawAutomateLike | undefined;
  private previousPasteHook: ExcalidrawPasteHook | null | undefined;
  private pasteHook: ExcalidrawPasteHook | undefined;

  constructor(
    private readonly app: App,
    provider: ProviderAdapter,
    private readonly options: ExcalidrawUploaderOptions,
  ) {
    this.coordinator = new UploadCoordinator(
      provider,
      new ExcalidrawReferenceAdapter(),
      options.callbacks,
    );
    this.notify = options.notify ?? (() => undefined);
    this.confirmUploadAll =
      options.confirmUploadAll ?? defaultConfirmUploadAll;
  }

  canRun(): boolean {
    return !!getActiveExcalidrawView(this.app) && !!getExcalidrawHost(this.app);
  }

  /** Registers the optional Excalidraw paste hook once the dependency is ready. */
  registerPasteHook(): boolean {
    const host = getExcalidrawHost(this.app);
    if (!host) return false;
    if (this.hookHost === host) {
      return host.onPasteHook === this.pasteHook;
    }

    this.restorePasteHook();
    const previous = host.onPasteHook;
    const hook: ExcalidrawPasteHook = (data) => {
      let previousResult: boolean | void;
      try {
        previousResult = previous?.(data);
      } catch {
        // A third-party hook must not prevent Excalidraw's native paste.
        return true;
      }
      if (previousResult === false) return false;
      if (!this.isAutomaticPasteUploadEnabled()) {
        return previousResult ?? true;
      }
      if (!this.options.getProfile()?.endpoint.trim()) {
        return previousResult ?? true;
      }
      const image = getSingleSupportedImage(data.event?.clipboardData ?? null);
      if (!image) {
        return previousResult ?? true;
      }

      // Take over the paste. Picbed inserts the image at the pointer itself,
      // so there is no separate native copy to wait for or replace.
      void this.pasteImage(
        { host: data.ea, view: data.view, notePath: getNotePath(data.view) },
        image,
        data.pointerPosition,
      );
      return false;
    };

    try {
      host.onPasteHook = hook;
    } catch {
      return false;
    }
    this.hookHost = host;
    this.previousPasteHook = previous;
    this.pasteHook = hook;
    return true;
  }

  /** Restores a hook owned by another script/plugin when Picbed unloads. */
  dispose(): void {
    this.restorePasteHook();
  }

  async uploadCurrentDrawing(): Promise<ExcalidrawUploadSummary> {
    const summary = createEmptySummary();
    try {
      const profile = this.options.getProfile();
      if (!profile || !profile.endpoint.trim()) {
        this.notify("Configure a valid Picbed Manager upload profile first.");
        return summary;
      }

      const view = getActiveExcalidrawView(this.app);
      if (!view) {
        this.notify("Open an Excalidraw drawing before uploading its images.");
        return summary;
      }

      const host = getExcalidrawHost(this.app);
      if (!host) {
        this.notify(
          "The Excalidraw plugin is unavailable or does not expose getAPI().",
        );
        return summary;
      }
      const target: DrawingTarget = { host, view, notePath: view.file?.path };

      const { selected, allImages } = queryDrawing(host, view, (automate) => ({
        selected: automate
          .getViewSelectedElements()
          .filter(isExcalidrawImageElement),
        allImages: automate.getViewElements().filter(isExcalidrawImageElement),
      }));
      const chosen = chooseImages(selected, allImages, this.confirmUploadAll);
      summary.total = chosen.length;
      if (chosen.length === 0) {
        if (allImages.length === 0) {
          this.notify("No image elements found in the current Excalidraw drawing.");
        }
        return summary;
      }

      await this.enqueue(() =>
        this.uploadLocalImages(target, profile, chosen, summary),
      );
      return summary;
    } catch (error) {
      this.notify(
        `Excalidraw image upload failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return summary;
    }
  }

  getJobs() {
    return this.coordinator.getJobs();
  }

  getJob(jobId: string) {
    return this.coordinator.getJob(jobId);
  }

  async retry(jobId: string, retryCount: number) {
    return this.coordinator.retry(jobId, retryCount);
  }

  /** Runs uploads one at a time so overlapping requests queue instead of dropping. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Inserts a pasted image at the pointer right away, then queues its upload.
   * The image stays visible and editable while it uploads.
   */
  private async pasteImage(
    target: DrawingTarget,
    image: File,
    position: { x: number; y: number },
  ): Promise<void> {
    let bytes: ArrayBuffer;
    let element: ExcalidrawImageElementLike;
    try {
      bytes = await image.arrayBuffer();
      element = await insertImage(
        target.host,
        target.view,
        toImageDataURL(bytes, image.type),
        position,
      );
    } catch (error) {
      this.notify(
        `Could not paste the image into Excalidraw: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return;
    }
    await this.enqueue(() =>
      this.uploadPastedImage(target, element, image, bytes),
    );
  }

  private async uploadPastedImage(
    target: DrawingTarget,
    element: ExcalidrawImageElementLike,
    image: File,
    bytes: ArrayBuffer,
  ): Promise<void> {
    const profile = this.options.getProfile();
    if (!profile || !profile.endpoint.trim()) return;
    const summary = createEmptySummary();
    summary.total = 1;
    try {
      const source: AssetSource = {
        sourceId: createId("source"),
        fileName: image.name || `pasted-image-${Date.now()}.png`,
        mimeType: image.type,
        bytes,
        origin: "excalidraw",
      };
      await this.uploadSource(target, profile, element, source, summary);
      this.reportSummary(summary);
    } catch (error) {
      this.notify(
        `Excalidraw pasted image upload failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async uploadLocalImages(
    target: DrawingTarget,
    profile: UploadProfile,
    elements: readonly ExcalidrawImageElementLike[],
    summary: ExcalidrawUploadSummary,
  ): Promise<void> {
    // Resolve files when this upload starts: images committed by earlier
    // queued uploads are hyperlinks by now and are skipped.
    const candidates = queryDrawing(target.host, target.view, (automate) =>
      getLocalCandidates(automate, elements),
    );
    summary.skipped += elements.length - candidates.length;
    if (candidates.length === 0) {
      this.notify(
        "No local Excalidraw images are available to upload. Web links, embedded notes, and PDF pages were left unchanged.",
      );
      return;
    }

    const prepared = await this.readCandidates(candidates, summary);
    if (prepared.length === 0) {
      this.notify("No readable local Excalidraw images were found.");
      return;
    }

    for (const candidate of prepared) {
      const source: AssetSource = {
        sourceId: createId("source"),
        fileName: candidate.file.name,
        mimeType: candidate.mimeType,
        bytes: candidate.bytes,
        origin: "excalidraw",
      };
      await this.uploadSource(
        target,
        profile,
        candidate.element,
        source,
        summary,
      );
    }
    this.reportSummary(summary);
  }

  private async readCandidates(
    candidates: readonly UploadCandidate[],
    summary: ExcalidrawUploadSummary,
  ): Promise<PreparedCandidate[]> {
    const prepared: PreparedCandidate[] = [];
    for (const candidate of candidates) {
      try {
        prepared.push({
          ...candidate,
          bytes: await this.app.vault.readBinary(candidate.file),
        });
      } catch (error) {
        summary.skipped += 1;
        this.notify(
          `Could not read ${candidate.file.name}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
    return prepared;
  }

  private async uploadSource(
    target: DrawingTarget,
    profile: UploadProfile,
    element: ExcalidrawImageElementLike,
    source: AssetSource,
    summary: ExcalidrawUploadSummary,
  ): Promise<void> {
    const context: ExcalidrawReferenceContext = {
      host: target.host,
      view: target.view,
      elementId: element.id,
      fileId: element.fileId,
    };
    const job = this.coordinator.create(
      source,
      profile,
      context,
      target.notePath,
    );
    const completed = await this.coordinator.run(
      job.id,
      this.options.getRetryCount(),
    );
    if (completed.status === "succeeded") {
      summary.uploaded += 1;
    } else if (completed.status === "cancelled") {
      summary.cancelled += 1;
      this.notify(`Upload cancelled: ${source.fileName}`);
    } else {
      summary.failed += 1;
      this.notify(
        `Excalidraw image upload failed for ${source.fileName}: ${
          completed.error?.message ?? "Unknown error"
        }`,
      );
    }
  }

  private reportSummary(summary: ExcalidrawUploadSummary): void {
    if (summary.uploaded > 0) {
      this.notify(`Uploaded ${summary.uploaded} Excalidraw image(s).`);
    } else if (summary.failed === 0 && summary.cancelled === 0) {
      this.notify("No Excalidraw images were uploaded.");
    }
  }

  private isAutomaticPasteUploadEnabled(): boolean {
    return this.options.autoUploadOnPaste?.() ?? true;
  }

  private restorePasteHook(): void {
    if (
      this.hookHost &&
      this.hookHost.onPasteHook === this.pasteHook
    ) {
      this.hookHost.onPasteHook = this.previousPasteHook ?? null;
    }
    this.hookHost = undefined;
    this.previousPasteHook = undefined;
    this.pasteHook = undefined;
  }
}

export function getActiveExcalidrawView(
  app: App,
): ActiveExcalidrawViewLike | undefined {
  const view = app.workspace.activeLeaf?.view as unknown as
    | ActiveExcalidrawViewLike
    | undefined;
  const viewType = view?.getViewType?.();
  return viewType?.toLowerCase() === "excalidraw" ? view : undefined;
}

/**
 * Returns the Excalidraw plugin's ExcalidrawAutomate instance. It receives
 * view hooks such as `onPasteHook`, and its `getAPI()` creates the private
 * instances Picbed uses for reading and committing drawings.
 */
export function getExcalidrawHost(
  app: App,
): ExcalidrawAutomateLike | undefined {
  const manager = (app as AppWithPluginManager).plugins;
  const plugin =
    manager?.plugins?.[EXCALIDRAW_PLUGIN_ID] ??
    manager?.getPlugin?.(EXCALIDRAW_PLUGIN_ID);
  if (typeof plugin !== "object" || plugin === null) return undefined;
  const host = (plugin as ExcalidrawPluginLike).ea;
  return typeof host?.getAPI === "function" ? host : undefined;
}

function chooseImages(
  selected: readonly ExcalidrawImageElementLike[],
  allImages: readonly ExcalidrawImageElementLike[],
  confirmUploadAll: (message: string) => boolean,
): readonly ExcalidrawImageElementLike[] {
  if (selected.length > 0) return selected;
  if (allImages.length === 0) return [];
  return confirmUploadAll(
    "No Excalidraw image is selected. Upload all image elements in this drawing?",
  )
    ? allImages
    : [];
}

function getLocalCandidates(
  automate: ExcalidrawAutomateLike,
  elements: readonly ExcalidrawImageElementLike[],
): UploadCandidate[] {
  const candidates = new Map<string, UploadCandidate>();
  for (const element of elements) {
    if (candidates.has(element.fileId)) continue;
    try {
      const file = automate.getViewFileForImageElement(element);
      // Embedded notes, PDF pages, and nested drawings are image elements too.
      const mimeType = file && imageMimeTypeForExtension(file.extension);
      if (file && mimeType) {
        candidates.set(element.fileId, { element, file, mimeType });
      }
    } catch {
      // An external hyperlink or an image removed during the command is skipped.
    }
  }
  return [...candidates.values()];
}

function getNotePath(view: unknown): string | undefined {
  if (typeof view !== "object" || view === null) return undefined;
  const file = (view as ActiveExcalidrawViewLike).file;
  return file?.path;
}

function createEmptySummary(): ExcalidrawUploadSummary {
  return { total: 0, uploaded: 0, skipped: 0, failed: 0, cancelled: 0 };
}

function defaultConfirmUploadAll(message: string): boolean {
  return typeof globalThis.confirm === "function"
    ? globalThis.confirm(message)
    : true;
}
