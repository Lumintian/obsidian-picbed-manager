import type { AssetRecord, AssetResult, AssetSource } from "./asset";
import type { UploadProfile } from "../settings/model";

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

export interface ProviderAdapter {
  readonly kind: UploadProfile["kind"];
  upload(
    source: AssetSource,
    profile: UploadProfile,
    signal?: AbortSignal,
  ): Promise<AssetResult>;
  delete?(
    asset: AssetRecord,
    profile: UploadProfile,
    signal?: AbortSignal,
  ): Promise<void>;
  test?(profile: UploadProfile, signal?: AbortSignal): Promise<ProviderTestResult>;
}
