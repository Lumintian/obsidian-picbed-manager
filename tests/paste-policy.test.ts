import { describe, expect, it } from "vitest";
import { noteAllowsAutoUpload } from "../src/ingestion/paste-policy";

describe("noteAllowsAutoUpload", () => {
  it("uses frontmatter override when present", () => {
    expect(noteAllowsAutoUpload({ frontmatter: { "picbed-auto-upload": false } }, true)).toBe(false);
    expect(noteAllowsAutoUpload({ frontmatter: { "picbed-auto-upload": true } }, false)).toBe(true);
  });

  it("falls back to global behavior", () => {
    expect(noteAllowsAutoUpload(undefined, true)).toBe(true);
  });
});
