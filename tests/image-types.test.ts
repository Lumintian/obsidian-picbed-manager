import { describe, expect, it } from "vitest";
import {
  imageMimeTypeForExtension,
  toImageDataURL,
} from "../src/shared/image-types";

describe("toImageDataURL", () => {
  it("encodes bytes as a base64 data URL", () => {
    expect(toImageDataURL(new Uint8Array([7, 8, 9]).buffer, "image/png")).toBe(
      "data:image/png;base64,BwgJ",
    );
  });

  it("encodes images larger than one chunk", () => {
    const bytes = new Uint8Array(70_000).map((_, index) => index % 251);

    const dataURL = toImageDataURL(bytes.buffer, "image/jpeg");

    const decoded = Uint8Array.from(
      atob(dataURL.slice("data:image/jpeg;base64,".length)),
      (character) => character.charCodeAt(0),
    );
    expect(decoded).toEqual(bytes);
  });
});

describe("imageMimeTypeForExtension", () => {
  it("accepts supported image extensions in any case", () => {
    expect(imageMimeTypeForExtension("JPG")).toBe("image/jpeg");
    expect(imageMimeTypeForExtension("svg")).toBe("image/svg+xml");
  });

  it("rejects notes, PDFs, and other files", () => {
    expect(imageMimeTypeForExtension("md")).toBeUndefined();
    expect(imageMimeTypeForExtension("pdf")).toBeUndefined();
  });
});
