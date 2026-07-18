export const SETTINGS_SCHEMA_VERSION = 1;

export interface HeaderSetting {
  name: string;
  value: string;
  secret: boolean;
}

export interface ExtraFieldSetting {
  name: string;
  value: string;
}

export interface UploadProfile {
  id: string;
  name: string;
  kind: "custom-api";
  endpoint: string;
  method: "POST";
  fileField: string;
  extraFields: ExtraFieldSetting[];
  headers: HeaderSetting[];
  responseUrlPath: string;
  responseUrlBase: string;
  responseAssetIdPath: string;
  responseDeletePayloadPath: string;
  timeoutMs: number;
}

export interface BehaviorSettings {
  autoUploadOnPaste: boolean;
  preserveAltText: boolean;
  retryCount: number;
  historyLimit: number;
}

export interface PluginSettings {
  schemaVersion: number;
  profiles: UploadProfile[];
  defaultProfileId: string;
  behavior: BehaviorSettings;
}

export const DEFAULT_PROFILE: UploadProfile = {
  id: "default",
  name: "Default API",
  kind: "custom-api",
  endpoint: "",
  method: "POST",
  fileField: "file",
  extraFields: [],
  headers: [],
  responseUrlPath: "url",
  responseUrlBase: "",
  responseAssetIdPath: "",
  responseDeletePayloadPath: "",
  timeoutMs: 30_000,
};

export const DEFAULT_SETTINGS: PluginSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  profiles: [DEFAULT_PROFILE],
  defaultProfileId: DEFAULT_PROFILE.id,
  behavior: {
    autoUploadOnPaste: true,
    preserveAltText: true,
    retryCount: 1,
    historyLimit: 50,
  },
};

export function cloneDefaultProfile(id = DEFAULT_PROFILE.id): UploadProfile {
  return {
    ...DEFAULT_PROFILE,
    id,
    extraFields: [],
    headers: [],
  };
}
