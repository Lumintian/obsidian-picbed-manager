import { describe, expect, it } from "vitest";
import { UploadError } from "../src/domain/errors";
import {
  getRequiredStringAtPath,
  getValueAtPath,
} from "../src/providers/custom-api/path-selector";

describe("path selector", () => {
  it("reads nested object values", () => {
    expect(
      getValueAtPath({ data: { url: "https://img.test/a.png" } }, "data.url"),
    ).toBe("https://img.test/a.png");
  });

  it("unwraps a single-item root array for an object-style path", () => {
    const response = [
      {
        src: "/file/a.png",
        publicUrl: "https://img.test/a.png",
      },
    ];
    expect(getRequiredStringAtPath(response, "publicUrl")).toBe(
      "https://img.test/a.png",
    );
  });

  it("supports explicit array indexes", () => {
    expect(
      getRequiredStringAtPath(
        [{ publicUrl: "https://img.test/a.png" }],
        "0.publicUrl",
      ),
    ).toBe("https://img.test/a.png");
    expect(
      getRequiredStringAtPath(
        { files: [{ publicUrl: "https://img.test/a.png" }] },
        "files.0.publicUrl",
      ),
    ).toBe("https://img.test/a.png");
  });

  it("requires an explicit index for a multi-item root array", () => {
    expect(() =>
      getRequiredStringAtPath(
        [{ publicUrl: "one" }, { publicUrl: "two" }],
        "publicUrl",
      ),
    ).toThrow('start the path with an index such as "0.publicUrl"');
  });

  it("reports missing and invalid URL values", () => {
    expect(() => getRequiredStringAtPath({}, "data.url")).toThrowError(
      UploadError,
    );
    expect(() =>
      getRequiredStringAtPath({ data: { url: 42 } }, "data.url"),
    ).toThrow("must contain a non-empty string");
  });
});
