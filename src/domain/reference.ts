import type { AssetResult } from "./asset";
import type { UploadError } from "./errors";
import type { UploadJob } from "./upload-job";

export interface ReferenceAnchor {
  token: string;
}

export interface ReferenceAdapter<TContext> {
  insertPending(context: TContext, job: UploadJob): ReferenceAnchor;
  commit(
    context: TContext,
    anchor: ReferenceAnchor,
    result: AssetResult,
  ): Promise<void>;
  fail(
    context: TContext,
    anchor: ReferenceAnchor,
    error: UploadError,
  ): Promise<void>;
}
