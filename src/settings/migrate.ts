import {
  cloneDefaultProfile,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  type PluginSettings,
  type UploadProfile,
} from "./model";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeProfile(value: unknown, index: number): UploadProfile {
  const record = asRecord(value) ?? {};
  const fallback = cloneDefaultProfile(`profile-${index + 1}`);
  const headers = Array.isArray(record.headers)
    ? record.headers.flatMap((item) => {
        const header = asRecord(item);
        if (!header) return [];
        return [
          {
            name: typeof header.name === "string" ? header.name : "",
            value: typeof header.value === "string" ? header.value : "",
            secret: header.secret === true,
          },
        ];
      })
    : [];
  const extraFields = Array.isArray(record.extraFields)
    ? record.extraFields.flatMap((item) => {
        const field = asRecord(item);
        if (!field) return [];
        return [
          {
            name: typeof field.name === "string" ? field.name : "",
            value: typeof field.value === "string" ? field.value : "",
          },
        ];
      })
    : [];

  return {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id
        : fallback.id,
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name
        : fallback.name,
    kind: "custom-api",
    endpoint: typeof record.endpoint === "string" ? record.endpoint : "",
    method: "POST",
    fileField:
      typeof record.fileField === "string" && record.fileField.trim()
        ? record.fileField
        : fallback.fileField,
    extraFields,
    headers,
    responseUrlPath:
      typeof record.responseUrlPath === "string"
        ? record.responseUrlPath
        : fallback.responseUrlPath,
    responseAssetIdPath:
      typeof record.responseAssetIdPath === "string"
        ? record.responseAssetIdPath
        : "",
    responseDeletePayloadPath:
      typeof record.responseDeletePayloadPath === "string"
        ? record.responseDeletePayloadPath
        : "",
    timeoutMs:
      typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs)
        ? Math.min(Math.max(Math.round(record.timeoutMs), 1_000), 300_000)
        : fallback.timeoutMs,
  };
}

export function migrateSettings(raw: unknown): PluginSettings {
  const record = asRecord(raw) ?? {};
  const rawProfiles = Array.isArray(record.profiles) ? record.profiles : [];
  const profiles =
    rawProfiles.length > 0
      ? rawProfiles.map(normalizeProfile)
      : [cloneDefaultProfile()];
  const behavior = asRecord(record.behavior) ?? {};
  const requestedDefault =
    typeof record.defaultProfileId === "string"
      ? record.defaultProfileId
      : DEFAULT_SETTINGS.defaultProfileId;
  const defaultProfileId = profiles.some(
    (profile) => profile.id === requestedDefault,
  )
    ? requestedDefault
    : profiles[0]?.id ?? DEFAULT_SETTINGS.defaultProfileId;

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    profiles,
    defaultProfileId,
    behavior: {
      autoUploadOnPaste:
        typeof behavior.autoUploadOnPaste === "boolean"
          ? behavior.autoUploadOnPaste
          : DEFAULT_SETTINGS.behavior.autoUploadOnPaste,
      preserveAltText:
        typeof behavior.preserveAltText === "boolean"
          ? behavior.preserveAltText
          : DEFAULT_SETTINGS.behavior.preserveAltText,
      retryCount:
        typeof behavior.retryCount === "number"
          ? Math.min(Math.max(Math.round(behavior.retryCount), 0), 5)
          : DEFAULT_SETTINGS.behavior.retryCount,
      historyLimit:
        typeof behavior.historyLimit === "number"
          ? Math.min(Math.max(Math.round(behavior.historyLimit), 10), 200)
          : DEFAULT_SETTINGS.behavior.historyLimit,
    },
  };
}
