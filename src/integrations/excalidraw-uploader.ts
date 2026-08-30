import type { App, TFile } from "obsidian";
import type { AssetSource } from "../domain/asset";
import type { ProviderAdapter } from "../domain/provider";
import type { UploadCoordinatorCallbacks } from "../operations/upload-coordinator";
import { UploadCoordinator } from "../operations/upload-coordinator";
import {
  ExcalidrawReferenceAdapter,
  isExcalidrawImageElement,
  type ExcalidrawAutomateLike,
  type ExcalidrawElementLike,
  type ExcalidrawReferenceContext,
} from "../references/excalidraw-adapter";
import { createId } from "../shared/id";
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
  getAPI?: () => ExcalidrawAutomateLike;
}

interface ActiveExcalidrawViewLike {
  getViewType?: () => string;
  file?: TFile | null;
}

interface UploadCandidate {
  element: ExcalidrawElementLike & { fileId: string };
  file: TFile;
}

interface PreparedCandidate extends UploadCandidate {
  bytes: ArrayBuffer;
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
  callbacks: UploadCoordinatorCallbacks;
  notify?: (message: string) => void;
  confirmUploadAll?: (message: string) => boolean;
}

/**
 * Integrates with Excalidraw from the outside, using only its public
 * ExcalidrawAutomate API. The integration is command-driven and therefore
 * does not replace Excalidraw's own paste/drop handlers.
 */
export class ExcalidrawUploader {
  private readonly coordinator: UploadCoordinator<ExcalidrawReferenceContext>;
  private readonly notify: (message: string) => void;
  private readonly confirmUploadAll: (message: string) => boolean;
  private running = false;

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
    return !this.running && !!getActiveExcalidrawView(this.app) && !!getExcalidrawPlugin(this.app);
  }

  async uploadCurrentDrawing(): Promise<ExcalidrawUploadSummary> {
    const summary = createEmptySummary();
    if (this.running) return summary;
    this.running = true;

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

      const automate = getExcalidrawAutomate(this.app);
      if (!automate) {
        this.notify(
          "The Excalidraw plugin is unavailable or does not expose getAPI().",
        );
        return summary;
      }
      automate.setView(view);

      const selected = automate
        .getViewSelectedElements()
        .filter(isExcalidrawImageElement);
      const allImages = automate
        .getViewElements()
        .filter(isExcalidrawImageElement);
      const chosen = chooseImages(selected, allImages, this.confirmUploadAll);
      summary.total = chosen.length;
      if (chosen.length === 0) {
        if (allImages.length === 0) {
          this.notify("No image elements found in the current Excalidraw drawing.");
        }
        return summary;
      }

      const candidates = getLocalCandidates(automate, chosen);
      summary.skipped += chosen.length - candidates.length;
      if (candidates.length === 0) {
        this.notify(
          "No local Excalidraw images are available to upload. Existing external image links were left unchanged.",
        );
        return summary;
      }

      const prepared = await this.readCandidates(candidates, summary);
      if (prepared.length === 0) {
        this.notify("No readable local Excalidraw images were found.");
        return summary;
      }

      automate.copyViewElementsToEAforEditing(
        prepared.map((candidate) => candidate.element),
        true,
      );
      for (const candidate of prepared) {
        await this.uploadCandidate(
          automate,
          view.file?.path,
          profile,
          candidate,
          summary,
        );
      }

      this.reportSummary(summary);
      return summary;
    } catch (error) {
      this.notify(
        `Excalidraw image upload failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return summary;
    } finally {
      this.running = false;
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

  private async uploadCandidate(
    automate: ExcalidrawAutomateLike,
    notePath: string | undefined,
    profile: UploadProfile,
    candidate: PreparedCandidate,
    summary: ExcalidrawUploadSummary,
  ): Promise<void> {
    const source: AssetSource = {
      sourceId: createId("source"),
      fileName: candidate.file.name,
      mimeType: mimeTypeForExtension(candidate.file.extension),
      bytes: candidate.bytes,
      origin: "excalidraw",
    };
    const context: ExcalidrawReferenceContext = {
      automate,
      elementId: candidate.element.id,
      fileId: candidate.element.fileId,
    };
    const job = this.coordinator.create(source, profile, context, notePath);
    const completed = await this.coordinator.run(
      job.id,
      this.options.getRetryCount(),
    );
    if (completed.status === "succeeded") {
      summary.uploaded += 1;
    } else if (completed.status === "cancelled") {
      summary.cancelled += 1;
      this.notify(`Upload cancelled: ${candidate.file.name}`);
    } else {
      summary.failed += 1;
      this.notify(
        `Excalidraw image upload failed for ${candidate.file.name}: ${
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

export function getExcalidrawPlugin(
  app: App,
): ExcalidrawPluginLike | undefined {
  const manager = (app as AppWithPluginManager).plugins;
  const plugin = manager?.plugins?.[EXCALIDRAW_PLUGIN_ID] ?? manager?.getPlugin?.(EXCALIDRAW_PLUGIN_ID);
  if (typeof plugin !== "object" || plugin === null) return undefined;
  const excalidrawPlugin = plugin as ExcalidrawPluginLike;
  return typeof excalidrawPlugin.getAPI === "function"
    ? excalidrawPlugin
    : undefined;
}

function getExcalidrawAutomate(app: App): ExcalidrawAutomateLike | undefined {
  const plugin = getExcalidrawPlugin(app);
  if (!plugin?.getAPI) return undefined;
  try {
    return plugin.getAPI();
  } catch {
    return undefined;
  }
}

function chooseImages(
  selected: readonly (ExcalidrawElementLike & { fileId: string })[],
  allImages: readonly (ExcalidrawElementLike & { fileId: string })[],
  confirmUploadAll: (message: string) => boolean,
): readonly (ExcalidrawElementLike & { fileId: string })[] {
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
  elements: readonly (ExcalidrawElementLike & { fileId: string })[],
): UploadCandidate[] {
  const candidates = new Map<string, UploadCandidate>();
  for (const element of elements) {
    if (candidates.has(element.fileId)) continue;
    try {
      const file = automate.getViewFileForImageElement(element);
      if (file) candidates.set(element.fileId, { element, file });
    } catch {
      // An external hyperlink or an image removed during the command is skipped.
    }
  }
  return [...candidates.values()];
}

function mimeTypeForExtension(extension: string): string {
  const mimeTypes: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    tif: "image/tiff",
    tiff: "image/tiff",
    webp: "image/webp",
  };
  return mimeTypes[extension.toLowerCase()] ?? "application/octet-stream";
}

function createEmptySummary(): ExcalidrawUploadSummary {
  return { total: 0, uploaded: 0, skipped: 0, failed: 0, cancelled: 0 };
}

function defaultConfirmUploadAll(message: string): boolean {
  return typeof globalThis.confirm === "function"
    ? globalThis.confirm(message)
    : true;
}
