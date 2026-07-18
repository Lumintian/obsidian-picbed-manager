import { describe, expect, it } from "vitest";
import { PROFILE_FIELD_HELP } from "../src/settings/profile-help";

describe("profile field help", () => {
  it("marks the request and URL mapping fields as required", () => {
    expect(PROFILE_FIELD_HELP.endpoint.required).toBe(true);
    expect(PROFILE_FIELD_HELP.fileField.required).toBe(true);
    expect(PROFILE_FIELD_HELP.responseUrlPath.required).toBe(true);
  });

  it("marks future deletion metadata as optional", () => {
    expect(PROFILE_FIELD_HELP.responseAssetIdPath.required).toBe(false);
    expect(PROFILE_FIELD_HELP.responseDeletePayloadPath.required).toBe(false);
    expect(PROFILE_FIELD_HELP.headers.required).toBe(false);
    expect(PROFILE_FIELD_HELP.extraFields.required).toBe(false);
  });
});
