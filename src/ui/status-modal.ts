import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type { OperationHistoryEntry, UploadJob } from "../domain/upload-job";

export interface StatusModalSource {
  jobs(): UploadJob[];
  history(): OperationHistoryEntry[];
  retry(jobId: string): Promise<void>;
  clearHistory(): Promise<void>;
}

export class UploadStatusModal extends Modal {
  constructor(
    app: App,
    private readonly source: StatusModalSource,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Picbed upload status" });

    const jobs = this.source.jobs().slice().reverse();
    const history = this.source.history().slice().reverse();
    const latest = mergeLatest(jobs, history);
    if (latest.length === 0) {
      this.contentEl.createEl("p", { text: "No upload operations yet." });
    } else {
      const list = this.contentEl.createDiv({ cls: "picbed-manager-status-list" });
      for (const item of latest) {
        const row = list.createDiv({ cls: "picbed-manager-status-item" });
        row.createEl("strong", { text: item.fileName });
        row.createEl("p", { text: `Status: ${item.status}` });
        if (item.message) row.createEl("p", { text: item.message });
        if (item.url) {
          row.createEl("p").createEl("a", { text: item.url, href: item.url });
        }
        if (item.retryable) {
          const actions = row.createDiv({ cls: "picbed-manager-status-actions" });
          const retry = actions.createEl("button", { text: "Retry" });
          retry.addEventListener("click", () => {
            retry.disabled = true;
            void this.source
              .retry(item.id)
              .then(() => this.render())
              .catch((error: unknown) => {
                new Notice(error instanceof Error ? error.message : "Retry failed.");
                retry.disabled = false;
              });
          });
        }
      }
    }

    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText("Clear history").onClick(async () => {
        await this.source.clearHistory();
        this.render();
      }),
    );
  }
}

export interface StatusItem {
  id: string;
  fileName: string;
  status: string;
  message?: string;
  /** The hosted URL, shown even when inserting the link failed. */
  url?: string;
  retryable: boolean;
}

/**
 * Combines saved history with this session's jobs, newest data winning.
 * Only jobs still in memory can be retried; history from earlier sessions
 * has no image bytes or document to retry with.
 */
export function mergeLatest(
  jobs: UploadJob[],
  history: OperationHistoryEntry[],
): StatusItem[] {
  const items = new Map<string, StatusItem>();
  for (const entry of history) {
    items.set(entry.id, {
      id: entry.id,
      fileName: entry.fileName,
      status: entry.status,
      message: entry.errorMessage,
      url: entry.url,
      retryable: false,
    });
  }
  for (const job of jobs) {
    items.set(job.id, {
      id: job.id,
      fileName: job.source.fileName,
      status: job.status,
      message: job.error?.message,
      url: job.result?.url,
      retryable: job.status === "failed",
    });
  }
  return [...items.values()];
}
