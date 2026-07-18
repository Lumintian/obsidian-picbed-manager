import { describe, expect, it } from "vitest";
import { migrateSettings } from "../src/settings/migrate";
import { SETTINGS_SCHEMA_VERSION } from "../src/settings/model";

 describe("migrateSettings", () => {
  it("creates independent defaults", () => {
    const first = migrateSettings(undefined);
    const second = migrateSettings(undefined);
    first.profiles[0]?.headers.push({ name: "Authorization", value: "secret", secret: true });
    expect(second.profiles[0]?.headers).toEqual([]);
    expect(first.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("normalizes ranges and selects an existing profile", () => {
    const settings = migrateSettings({
      defaultProfileId: "missing",
      profiles: [{ id: "custom", name: "Custom", endpoint: "https://x.test", timeoutMs: 999999 }],
      behavior: { retryCount: 99, historyLimit: 1 },
    });
    expect(settings.defaultProfileId).toBe("custom");
    expect(settings.profiles[0]?.timeoutMs).toBe(300_000);
    expect(settings.behavior.retryCount).toBe(5);
    expect(settings.behavior.historyLimit).toBe(10);
  });
});
