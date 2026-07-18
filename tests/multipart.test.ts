import { describe, expect, it } from "vitest";
import { createMultipartBody } from "../src/providers/custom-api/multipart";
import { cloneDefaultProfile } from "../src/settings/model";

describe("createMultipartBody", () => {
  it("includes configured fields and file bytes", async () => {
    const profile = cloneDefaultProfile();
    profile.extraFields = [{ name: "album", value: "notes" }];
    const output = await createMultipartBody(
      {
        sourceId: "s1",
        fileName: "image.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3]).buffer,
        origin: "paste",
      },
      profile,
    );
    const text = new TextDecoder().decode(output.body);
    expect(output.contentType).toContain("multipart/form-data; boundary=");
    expect(text).toContain('name="album"');
    expect(text).toContain("notes");
    expect(text).toContain('name="file"; filename="image.png"');
  });
});
