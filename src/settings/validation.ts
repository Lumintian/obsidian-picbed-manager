import type { UploadProfile } from "./model";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateProfile(profile: UploadProfile): ValidationResult {
  const errors: string[] = [];
  if (!profile.name.trim()) errors.push("Profile name is required.");
  if (!profile.endpoint.trim()) {
    errors.push("API endpoint is required.");
  } else {
    try {
      const url = new URL(profile.endpoint);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.push("API endpoint must use HTTP or HTTPS.");
      }
    } catch {
      errors.push("API endpoint must be a valid URL.");
    }
  }
  if (!profile.fileField.trim()) errors.push("File field name is required.");
  if (!profile.responseUrlPath.trim()) {
    errors.push("Response URL path is required.");
  }
  if (profile.timeoutMs < 1_000 || profile.timeoutMs > 300_000) {
    errors.push("Timeout must be between 1 and 300 seconds.");
  }
  const duplicateHeaders = findDuplicates(
    profile.headers.map((header) => header.name.trim().toLowerCase()).filter(Boolean),
  );
  if (duplicateHeaders.length > 0) {
    errors.push(`Duplicate header names: ${duplicateHeaders.join(", ")}.`);
  }
  const duplicateFields = findDuplicates(
    profile.extraFields.map((field) => field.name.trim()).filter(Boolean),
  );
  if (duplicateFields.length > 0) {
    errors.push(`Duplicate extra field names: ${duplicateFields.join(", ")}.`);
  }
  return { valid: errors.length === 0, errors };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}
