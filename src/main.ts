import { MarkdownView, Notice, Plugin } from "obsidian";
import type { Editor, MarkdownFileInfo } from "obsidian";
import type { AssetRecord, AssetSource } from "./domain/asset";
import type { OperationHistoryEntry } from "./domain/upload-job";
import { getSingleSupportedImage, noteAllowsAutoUpload } from "./ingestion/paste-policy";
import {
  UploadCoordinator,
  type UploadCoordinatorCallbacks,
} from "./operations/upload-coordinator";
import { migratePersistedState, type PersistedState } from "./persistence/state";
import { CustomApiAdapter } from "./providers/custom-api/adapter";
import { obsidianTransport } from "./providers/custom-api/obsidian-transport";
import {
  MarkdownReferenceAdapter,
  type MarkdownReferenceContext,
} from "./references/markdown-adapter";
import { ExcalidrawUploader } from "./integrations/excalidraw-uploader";
import { createId } from "./shared/id";
import { PicbedManagerSettingTab } from "./settings/settings-tab";
import type { PluginSettings, UploadProfile } from "./settings/model";
import { UploadStatusModal } from "./ui/status-modal";

export default class PicbedManagerPlugin extends Plugin {
  settings!: PluginSettings;
  private state!: PersistedState;
  private coordinator!: UploadCoordinator<MarkdownReferenceContext>;
  private excalidrawUploader!: ExcalidrawUploader;

  async onload(): Promise<void> {
    await this.loadState();
    const callbacks: UploadCoordinatorCallbacks = {
      onJobChanged: () => undefined,
      onAssetCreated: async (asset) => this.recordAsset(asset),
      onHistory: async (entry) => this.recordHistory(entry),
    };
    const provider = new CustomApiAdapter(obsidianTransport);
    this.coordinator = new UploadCoordinator(
      provider,
      new MarkdownReferenceAdapter(),
      callbacks,
    );
    this.excalidrawUploader = new ExcalidrawUploader(this.app, provider, {
      getProfile: () => this.getDefaultProfile(),
      getRetryCount: () => this.settings.behavior.retryCount,
      callbacks,
      notify: (message) => new Notice(message),
    });

    this.addSettingTab(new PicbedManagerSettingTab(this.app, this));
    this.addRibbonIcon("image-up", "Picbed upload status", () => {
      this.openStatus();
    });
    this.addCommand({
      id: "upload-excalidraw-images",
      name: "Upload images in current Excalidraw drawing",
      checkCallback: (checking) => {
        const canRun = this.excalidrawUploader.canRun();
        if (canRun && !checking) {
          void this.excalidrawUploader.uploadCurrentDrawing();
        }
        return canRun;
      },
    });
    this.registerEvent(
      this.app.workspace.on("editor-paste", (event, editor, info) => {
        void this.handlePaste(event, editor, info);
      }),
    );
  }

  async saveState(): Promise<void> {
    this.state.settings = this.settings;
    await this.saveData(this.state);
  }

  async removeProfile(profileId: string): Promise<void> {
    if (this.settings.profiles.length <= 1) return;
    this.settings.profiles = this.settings.profiles.filter(
      (profile) => profile.id !== profileId,
    );
    if (this.settings.defaultProfileId === profileId) {
      this.settings.defaultProfileId = this.settings.profiles[0]?.id ?? "";
    }
    await this.saveState();
  }

  private async loadState(): Promise<void> {
    this.state = migratePersistedState(await this.loadData());
    this.settings = this.state.settings;
  }

  private async handlePaste(
    event: ClipboardEvent,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo,
  ): Promise<void> {
    if (event.defaultPrevented) return;
    const file = getSingleSupportedImage(event.clipboardData);
    if (!file) return;

    const activeFile = info.file;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (
      !activeFile ||
      !activeView ||
      activeView.editor !== editor ||
      activeView.file?.path !== activeFile.path
    ) {
      return;
    }
    const metadata = activeFile
      ? this.app.metadataCache.getFileCache(activeFile)
      : undefined;
    if (
      !noteAllowsAutoUpload(
        metadata,
        this.settings.behavior.autoUploadOnPaste,
      )
    ) {
      return;
    }

    const profile = this.getDefaultProfile();
    if (!profile || !profile.endpoint.trim()) {
      new Notice("Configure a valid Picbed Manager upload profile first.");
      return;
    }

    event.preventDefault();
    try {
      const source: AssetSource = {
        sourceId: createId("source"),
        fileName: file.name || `pasted-image-${Date.now()}.png`,
        mimeType: file.type,
        bytes: await file.arrayBuffer(),
        origin: "paste",
      };
      const context: MarkdownReferenceContext = {
        editor,
        altText: this.settings.behavior.preserveAltText ? source.fileName : "",
      };
      const job = this.coordinator.create(
        source,
        profile,
        context,
        activeFile?.path,
      );
      const result = await this.coordinator.run(
        job.id,
        this.settings.behavior.retryCount,
      );
      if (result.status === "failed") {
        new Notice(`Image upload failed: ${result.error?.message ?? "Unknown error"}`);
      } else if (result.status === "cancelled") {
        new Notice("Image upload cancelled.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the pasted image.";
      new Notice(`Image upload failed: ${message}`);
    }
  }

  private getDefaultProfile(): UploadProfile | undefined {
    return (
      this.settings.profiles.find(
        (profile) => profile.id === this.settings.defaultProfileId,
      ) ?? this.settings.profiles[0]
    );
  }

  private async recordAsset(asset: AssetRecord): Promise<void> {
    this.state.assets.push(asset);
    await this.saveState();
  }

  private async recordHistory(entry: OperationHistoryEntry): Promise<void> {
    const withoutPrevious = this.state.history.filter(
      (existing) => existing.id !== entry.id,
    );
    withoutPrevious.push(entry);
    this.state.history = withoutPrevious.slice(
      -this.settings.behavior.historyLimit,
    );
    await this.saveState();
  }

  private openStatus(): void {
    new UploadStatusModal(this.app, {
      jobs: () => [
        ...this.coordinator.getJobs(),
        ...this.excalidrawUploader.getJobs(),
      ],
      history: () => this.state.history,
      retry: async (jobId) => {
        const markdownJob = this.coordinator.getJob(jobId);
        const job = markdownJob
          ? await this.coordinator.retry(
              jobId,
              this.settings.behavior.retryCount,
            )
          : await this.excalidrawUploader.retry(
              jobId,
              this.settings.behavior.retryCount,
            );
        if (job.status !== "succeeded") {
          throw new Error(job.error?.message ?? "Retry failed.");
        }
      },
      clearHistory: async () => {
        this.state.history = [];
        await this.saveState();
      },
    }).open();
  }
}
