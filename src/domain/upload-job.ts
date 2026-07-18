import type { AssetResult, AssetSource } from "./asset";
import type { UploadError } from "./errors";

export type UploadJobStatus =
  | "queued"
  | "uploading"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface UploadJob {
  id: string;
  source: AssetSource;
  profileId: string;
  notePath?: string;
  status: UploadJobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  result?: AssetResult;
  error?: UploadError;
}

export interface OperationHistoryEntry {
  id: string;
  fileName: string;
  profileId: string;
  notePath?: string;
  status: Exclude<UploadJobStatus, "queued" | "uploading">;
  attempts: number;
  createdAt: string;
  completedAt: string;
  url?: string;
  errorCode?: UploadError["code"];
  errorMessage?: string;
}
