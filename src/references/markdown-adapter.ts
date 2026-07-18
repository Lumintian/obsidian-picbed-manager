import type { Editor, EditorPosition } from "obsidian";
import type { AssetResult } from "../domain/asset";
import { UploadError } from "../domain/errors";
import type { ReferenceAdapter, ReferenceAnchor } from "../domain/reference";
import type { UploadJob } from "../domain/upload-job";

export interface MarkdownReferenceContext {
  editor: Editor;
  altText: string;
}

export class MarkdownReferenceAdapter
  implements ReferenceAdapter<MarkdownReferenceContext>
{
  insertPending(
    context: MarkdownReferenceContext,
    job: UploadJob,
  ): ReferenceAnchor {
    const token = `picbed-manager://${job.id}`;
    context.editor.replaceSelection(
      `![${escapeAltText(context.altText)}](${token} "Uploading…")`,
    );
    return { token };
  }

  async commit(
    context: MarkdownReferenceContext,
    anchor: ReferenceAnchor,
    result: AssetResult,
  ): Promise<void> {
    replaceAnchoredImage(
      context.editor,
      anchor.token,
      `![${escapeAltText(context.altText)}](${escapeMarkdownUrl(result.url)})`,
    );
  }

  async fail(
    context: MarkdownReferenceContext,
    anchor: ReferenceAnchor,
    error: UploadError,
  ): Promise<void> {
    replaceAnchoredImage(
      context.editor,
      anchor.token,
      `![${escapeAltText(context.altText)}](${anchor.token} "Upload failed: ${escapeTitle(error.message)}")`,
    );
  }
}

function replaceAnchoredImage(
  editor: Editor,
  token: string,
  replacement: string,
): void {
  const content = editor.getValue();
  const tokenOffset = content.indexOf(token);
  if (tokenOffset === -1) {
    throw new UploadError(
      "reference-conflict",
      "The upload marker was edited or removed before the upload finished.",
    );
  }

  const imageStart = content.lastIndexOf("![", tokenOffset);
  const lineEnd = content.indexOf("\n", tokenOffset);
  const searchEnd = lineEnd === -1 ? content.length : lineEnd;
  const imageEnd = content.lastIndexOf(")", searchEnd);
  if (imageStart === -1 || imageEnd < tokenOffset) {
    throw new UploadError(
      "reference-conflict",
      "The upload marker is no longer a valid Markdown image reference.",
    );
  }

  editor.replaceRange(
    replacement,
    offsetToPosition(content, imageStart),
    offsetToPosition(content, imageEnd + 1),
  );
}

function offsetToPosition(content: string, offset: number): EditorPosition {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length - 1,
    ch: lines.at(-1)?.length ?? 0,
  };
}

function escapeAltText(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function escapeMarkdownUrl(value: string): string {
  return value
    .replaceAll(" ", "%20")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
}

function escapeTitle(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
