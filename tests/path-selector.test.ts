import { describe, expect, it } from "vitest";
import { UploadError } from "../src/domain/errors";
import { getRequiredStringAtPath, getValueAtPath } from "../src/providers/custom-api/path-selector";

describe("path selector", () => {
  it("reads nested values", () => {
    expect(getValueAtPath({ data: { url: "https://img.test/a.png" } }, "data.url"))
      .toBe("https://img.test/a.png");
  });

  it("reports missing and invalid URL values", () => {
    expect(() => getRequiredStringAtPath({}, "data.url")).toThrowError(UploadError);
    expect(() => getRequiredStringAtPath({ data: { url: 42 } }, "data.url"))
      .toThrow('must contain a non-empty string');
  });
});
