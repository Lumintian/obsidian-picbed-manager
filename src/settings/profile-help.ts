export type ProfileHelpKey =
  | "name"
  | "endpoint"
  | "fileField"
  | "responseUrlPath"
  | "responseAssetIdPath"
  | "responseDeletePayloadPath"
  | "timeout"
  | "headers"
  | "extraFields";

export interface ProfileFieldHelp {
  label: string;
  required: boolean;
  description: string;
  example?: string;
}

export const PROFILE_FIELD_HELP: Record<ProfileHelpKey, ProfileFieldHelp> = {
  name: {
    label: "Profile name",
    required: true,
    description: "A local display name used to distinguish upload configurations.",
    example: "Personal image server",
  },
  endpoint: {
    label: "API endpoint",
    required: true,
    description:
      "The complete HTTP(S) upload URL from your image host API documentation.",
    example: "https://images.example.com/api/upload",
  },
  fileField: {
    label: "Multipart file field",
    required: true,
    description:
      "The multipart/form-data parameter that carries the image. Look for the file parameter in the API documentation, often named file, image, or upload.",
    example: "file",
  },
  responseUrlPath: {
    label: "Response URL path",
    required: true,
    description:
      "Dot path to the public image URL in the JSON response. Object example: data.url. For a single-item array such as [{ publicUrl: \"...\" }], enter publicUrl (0.publicUrl also works).",
    example: "data.url or publicUrl",
  },
  responseAssetIdPath: {
    label: "Response asset ID path",
    required: false,
    description:
      "Optional dot path to the provider's image ID. Leave empty if the API does not return one. Stored for future image management.",
    example: "data.id",
  },
  responseDeletePayloadPath: {
    label: "Response delete descriptor path",
    required: false,
    description:
      "Optional dot path to deletion metadata returned by the API. Leave empty unless the response contains a delete token or descriptor.",
    example: "data.delete",
  },
  timeout: {
    label: "Timeout (seconds)",
    required: true,
    description: "Maximum time to wait for the upload API, from 1 to 300 seconds.",
    example: "30",
  },
  headers: {
    label: "HTTP headers",
    required: false,
    description:
      "Optional authentication or custom headers required by the API, such as Authorization or X-API-Key. Mark credential values as secret.",
  },
  extraFields: {
    label: "Extra form fields",
    required: false,
    description:
      "Optional text parameters sent in the same multipart request, such as album, folder, or strategy. Add only fields required by your API.",
  },
};

export const PROFILE_CONFIGURATION_STEPS = [
  "Find the upload endpoint and confirm it accepts multipart/form-data.",
  "Copy the API's image file parameter into Multipart file field.",
  "Add only the authentication headers and extra form fields required by the API.",
  "Upload once with the API's own tool or documentation example and inspect the JSON response.",
  "Convert the returned URL location into a dot path. A single-item root array is unwrapped automatically; explicit indexes such as 0.publicUrl are also supported.",
  "Validate the profile, then paste one image to verify the real response mapping.",
] as const;
