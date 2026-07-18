import { MarkdownView, Notice, Plugin } from "obsidian";
import type { Editor, MarkdownFileInfo } from "obsidian";
import type { AssetRecord, AssetSource } from "./domain/asset";
import type { OperationHistoryEntry } from "./domain/upload-job";
import { getSingleSupportedImage, noteAllowsAutoUpload } from "./ingestion/paste-policy";
import { UploadCoordinator } from "./operations/upload-coordinator";
import { migratePersistedState, type PersistedState } from "./persistence/state";
import { CustomApiAdapter } from "./providers/custom-api/adapter";
import { obsidianTransport } from "./providers/custom-api/obsidian-transport";
import {
  MarkdownReferenceAdapter,
  type MarkdownReferenceContext,
} from "./references/markdown-adapter";
import { createId } from "./shared/id";
import { PicbedManagerSettingTab } from "./settings/settings-tab";
import type { PluginSettings, UploadProfile } from "./settings/model";
import { UploadStatusModal } from "./ui/status-modal";

export default class PicbedManagerPlugin extends Plugin {
  settings!: PluginSettings;
  private state!: PersistedState;
  private coordinator!: UploadCoordinator<MarkdownReferenceContext>;

  async onload(): Promise<void> {
    await this.loadState();
    this.coordinator = new UploadCoordinator(
      new CustomApiAdapter(obsidianTransport),
      new MarkdownReferenceAdapter(),
      {
        onJobChanged: () => undefined,
        onAssetCreated: async (asset) => this.recordAsset(asset),
        onHistory: async (entry) => this.recordHistory(entry),
      },
    );

    this.addSettingTab(new PicbedManagerSettingTab(this.app, this));
    this.addRibbonIcon("image-up", "Picbed upload status", () => {
      this.openStatus();
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
      jobs: () => this.coordinator.getJobs(),
      history: () => this.state.history,
      retry: async (jobId) => {
        const job = await this.coordinator.retry(
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
