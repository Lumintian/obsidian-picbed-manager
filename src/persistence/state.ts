import type { AssetRecord } from "../domain/asset";
import type { OperationHistoryEntry } from "../domain/upload-job";
import { migrateSettings } from "../settings/migrate";
import type { PluginSettings } from "../settings/model";

export interface PersistedState {
  settings: PluginSettings;
  assets: AssetRecord[];
  history: OperationHistoryEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function migratePersistedState(raw: unknown): PersistedState {
  if (!isRecord(raw)) {
    return { settings: migrateSettings(undefined), assets: [], history: [] };
  }
  const settingsSource = isRecord(raw.settings) ? raw.settings : raw;
  return {
    settings: migrateSettings(settingsSource),
    assets: Array.isArray(raw.assets) ? (raw.assets as AssetRecord[]) : [],
    history: Array.isArray(raw.history)
      ? (raw.history as OperationHistoryEntry[])
      : [],
  };
}
