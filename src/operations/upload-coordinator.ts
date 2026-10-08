import type { AssetRecord, AssetResult, AssetSource } from "../domain/asset";
import { UploadError, toUploadError } from "../domain/errors";
import type { ProviderAdapter } from "../domain/provider";
import type { ReferenceAdapter, ReferenceAnchor } from "../domain/reference";
import type { OperationHistoryEntry, UploadJob } from "../domain/upload-job";
import { createId } from "../shared/id";
import type { UploadProfile } from "../settings/model";

interface ActiveOperation<TContext> {
  job: UploadJob;
  source: AssetSource;
  profile: UploadProfile;
  context: TContext;
  anchor: ReferenceAnchor;
  controller: AbortController;
}

export interface UploadCoordinatorCallbacks {
  onJobChanged(job: UploadJob): void | Promise<void>;
  onAssetCreated(asset: AssetRecord): void | Promise<void>;
  onHistory(entry: OperationHistoryEntry): void | Promise<void>;
}

export class UploadCoordinator<TContext> {
  private readonly operations = new Map<string, ActiveOperation<TContext>>();

  constructor(
    private readonly provider: ProviderAdapter,
    private readonly reference: ReferenceAdapter<TContext>,
    private readonly callbacks: UploadCoordinatorCallbacks,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(
    source: AssetSource,
    profile: UploadProfile,
    context: TContext,
    notePath?: string,
  ): UploadJob {
    const now = this.now().toISOString();
    const job: UploadJob = {
      id: createId("upload"),
      source,
      profileId: profile.id,
      notePath,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    const anchor = this.reference.insertPending(context, job);
    this.operations.set(job.id, {
      job,
      source,
      profile,
      context,
      anchor,
      controller: new AbortController(),
    });
    void this.callbacks.onJobChanged(job);
    return job;
  }

  async run(jobId: string, retryCount: number): Promise<UploadJob> {
    const operation = this.requireOperation(jobId);
    let lastError: UploadError | undefined;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      operation.job.status = "uploading";
      operation.job.attempts += 1;
      operation.job.updatedAt = this.now().toISOString();
      delete operation.job.error;
      await this.callbacks.onJobChanged(operation.job);

      try {
        // A job that already uploaded only failed to insert its link, so a
        // retry inserts the link again instead of uploading a duplicate.
        const result = operation.job.result ?? (await this.upload(operation));
        await this.reference.commit(operation.context, operation.anchor, result);
        operation.job.status = "succeeded";
        operation.job.updatedAt = this.now().toISOString();
        await this.complete(operation);
        return operation.job;
      } catch (error) {
        lastError = toUploadError(error);
        if (
          lastError.code === "cancelled" ||
          !lastError.retryable ||
          attempt >= retryCount
        ) {
          break;
        }
      }
    }

    const failure = lastError ?? new UploadError("unknown", "Upload failed.");
    operation.job.error = failure;
    operation.job.status = failure.code === "cancelled" ? "cancelled" : "failed";
    operation.job.updatedAt = this.now().toISOString();
    try {
      await this.reference.fail(
        operation.context,
        operation.anchor,
        failure,
        operation.job,
      );
    } catch (referenceError) {
      const normalizedReferenceError = toUploadError(referenceError);
      if (normalizedReferenceError.code !== "reference-conflict") {
        operation.job.error = normalizedReferenceError;
      }
    }
    await this.complete(operation);
    return operation.job;
  }

  async retry(jobId: string, retryCount: number): Promise<UploadJob> {
    const operation = this.requireOperation(jobId);
    operation.controller = new AbortController();
    return this.run(jobId, retryCount);
  }

  cancel(jobId: string): void {
    this.operations.get(jobId)?.controller.abort();
  }

  getJob(jobId: string): UploadJob | undefined {
    return this.operations.get(jobId)?.job;
  }

  getJobs(): UploadJob[] {
    return [...this.operations.values()].map((operation) => operation.job);
  }

  private async upload(
    operation: ActiveOperation<TContext>,
  ): Promise<AssetResult> {
    const result = await this.provider.upload(
      operation.source,
      operation.profile,
      operation.controller.signal,
    );
    operation.job.result = result;
    operation.job.updatedAt = this.now().toISOString();
    await this.callbacks.onAssetCreated({
      ...result,
      sourceId: operation.source.sourceId,
      fileName: operation.source.fileName,
      notePath: operation.job.notePath,
      createdAt: operation.job.updatedAt,
    });
    return result;
  }

  private requireOperation(jobId: string): ActiveOperation<TContext> {
    const operation = this.operations.get(jobId);
    if (!operation) throw new Error(`Unknown upload operation: ${jobId}`);
    return operation;
  }

  private async complete(operation: ActiveOperation<TContext>): Promise<void> {
    await this.callbacks.onJobChanged(operation.job);
    await this.callbacks.onHistory(toHistory(operation.job, this.now()));
  }
}

function toHistory(job: UploadJob, now: Date): OperationHistoryEntry {
  if (job.status === "queued" || job.status === "uploading") {
    throw new Error("Cannot persist an incomplete operation to history.");
  }
  return {
    id: job.id,
    fileName: job.source.fileName,
    profileId: job.profileId,
    notePath: job.notePath,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt,
    completedAt: now.toISOString(),
    url: job.result?.url,
    errorCode: job.error?.code,
    errorMessage: job.error?.message,
  };
}
