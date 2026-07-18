export type AssetOrigin = "paste" | "excalidraw";

export interface AssetSource {
  sourceId: string;
  fileName: string;
  mimeType?: string;
  bytes: ArrayBuffer;
  origin: AssetOrigin;
}

export interface AssetResult {
  url: string;
  assetId?: string;
  deleteDescriptor?: unknown;
  profileId: string;
  uploadedAt: string;
}

export interface AssetRecord extends AssetResult {
  sourceId: string;
  fileName: string;
  notePath?: string;
  createdAt: string;
}
