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
    const token = createAnchorToken(job.id);
    context.editor.replaceSelection(
      createStatusMarker(token, `Uploading ${context.altText || "image"}…`),
    );
    return { token };
  }

  async commit(
    context: MarkdownReferenceContext,
    anchor: ReferenceAnchor,
    result: AssetResult,
  ): Promise<void> {
    replaceAnchoredMarker(
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
    replaceAnchoredMarker(
      context.editor,
      anchor.token,
      createStatusMarker(
        anchor.token,
        `Upload failed: ${context.altText || "image"} — ${error.message}`,
      ),
    );
  }
}

function createAnchorToken(jobId: string): string {
  return `picbed-manager-upload:${jobId}`;
}

function createStatusMarker(token: string, text: string): string {
  return `⏳ ${escapeStatusText(text)} <!-- ${token} -->`;
}

function replaceAnchoredMarker(
  editor: Editor,
  token: string,
  replacement: string,
): void {
  const content = editor.getValue();
  const anchor = `<!-- ${token} -->`;
  const anchorOffset = content.indexOf(anchor);
  if (anchorOffset === -1) {
    throw new UploadError(
      "reference-conflict",
      "The upload marker was edited or removed before the upload finished.",
    );
  }

  const lineStartOffset = content.lastIndexOf("\n", anchorOffset - 1) + 1;
  const lineEndOffset = content.indexOf("\n", anchorOffset + anchor.length);
  const markerEndOffset = lineEndOffset === -1 ? content.length : lineEndOffset;
  const markerLine = content.slice(lineStartOffset, markerEndOffset);
  const statusStartOffset = markerLine.lastIndexOf("⏳ ", anchorOffset - lineStartOffset);
  if (!markerLine.includes(anchor) || statusStartOffset === -1) {
    throw new UploadError(
      "reference-conflict",
      "The upload marker is no longer valid.",
    );
  }

  editor.replaceRange(
    replacement,
    offsetToPosition(content, lineStartOffset + statusStartOffset),
    offsetToPosition(content, markerEndOffset),
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

function escapeStatusText(value: string): string {
  return value.replaceAll("\n", " ").replaceAll("-->", "—>");
}
