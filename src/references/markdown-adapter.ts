import type { Editor, EditorPosition, TFile } from "obsidian";
import type { AssetResult } from "../domain/asset";
import { UploadError } from "../domain/errors";
import type { ReferenceAdapter, ReferenceAnchor } from "../domain/reference";
import type { UploadJob } from "../domain/upload-job";

/** The Obsidian operations the Markdown adapter needs, injectable for tests. */
export interface MarkdownNoteAccess {
  /** Returns an editor that currently shows `note`, preferring `preferred`. */
  findEditor(note: TFile, preferred: Editor): Editor | undefined;
  read(note: TFile): Promise<string>;
  process(note: TFile, update: (content: string) => string): Promise<string>;
  /** Saves an image as an attachment of `note` and returns an embed for it. */
  saveAttachment(
    note: TFile,
    fileName: string,
    bytes: ArrayBuffer,
  ): Promise<{ path: string; embed: string }>;
}

export interface MarkdownReferenceContext {
  /** The editor the image was pasted into. */
  editor: Editor;
  /** The note the image belongs to. */
  note: TFile;
  altText: string;
  /** Set once a failed upload was saved as a local attachment. */
  localImage?: { path: string; embed: string };
}

interface TextRange {
  start: number;
  end: number;
}

/**
 * Keeps a placeholder in the note while an image uploads, then replaces it
 * with the hosted link. A failed upload is saved as a normal attachment so the
 * image is never lost; a later retry replaces that local embed instead.
 *
 * Edits go through an editor that shows the note, which keeps undo history
 * and unsaved changes intact. When no editor shows it any more, for example
 * because the tab moved to another note, the note file is edited directly.
 */
export class MarkdownReferenceAdapter
  implements ReferenceAdapter<MarkdownReferenceContext>
{
  constructor(private readonly notes: MarkdownNoteAccess) {}

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
    const link = `![${escapeAltText(context.altText)}](${escapeMarkdownUrl(result.url)})`;
    const localImage = context.localImage;
    if (localImage) {
      await this.replaceInNote(
        context,
        (content) => findText(content, localImage.embed),
        link,
        "The local image link was edited or removed before the upload finished.",
      );
      delete context.localImage;
      return;
    }
    await this.replaceInNote(
      context,
      (content) => findStatusMarker(content, anchor.token),
      link,
      "The upload marker was edited or removed before the upload finished.",
    );
  }

  async fail(
    context: MarkdownReferenceContext,
    anchor: ReferenceAnchor,
    error: UploadError,
    job: UploadJob,
  ): Promise<void> {
    // A retry that fails again leaves the earlier local copy in place.
    if (context.localImage) return;

    // Save a local copy only while the placeholder is still in the note, so
    // removing the placeholder during the upload discards the image.
    const content = await this.readNote(context);
    if (!findStatusMarker(content, anchor.token)) {
      throw new UploadError(
        "reference-conflict",
        "The upload marker was edited or removed before the upload finished.",
      );
    }

    let localImage: { path: string; embed: string };
    try {
      localImage = await this.notes.saveAttachment(
        context.note,
        job.source.fileName,
        job.source.bytes,
      );
    } catch {
      await this.replaceInNote(
        context,
        (current) => findStatusMarker(current, anchor.token),
        createStatusMarker(
          anchor.token,
          `Upload failed: ${context.altText || "image"} — ${error.message}`,
        ),
        "The upload marker was edited or removed before the upload finished.",
      );
      return;
    }

    context.localImage = localImage;
    await this.replaceInNote(
      context,
      (current) => findStatusMarker(current, anchor.token),
      localImage.embed,
      `The image was saved as ${localImage.path}, but the upload marker was removed before it could be inserted.`,
    );
  }

  private async readNote(context: MarkdownReferenceContext): Promise<string> {
    const editor = this.notes.findEditor(context.note, context.editor);
    if (editor) return editor.getValue();
    try {
      return await this.notes.read(context.note);
    } catch (error) {
      throw noteUnavailable(error);
    }
  }

  private async replaceInNote(
    context: MarkdownReferenceContext,
    locate: (content: string) => TextRange | undefined,
    replacement: string,
    conflictMessage: string,
  ): Promise<void> {
    const editor = this.notes.findEditor(context.note, context.editor);
    if (editor) {
      const content = editor.getValue();
      const range = locate(content);
      if (!range) throw new UploadError("reference-conflict", conflictMessage);
      editor.replaceRange(
        replacement,
        offsetToPosition(content, range.start),
        offsetToPosition(content, range.end),
      );
      return;
    }

    let replaced = false;
    try {
      await this.notes.process(context.note, (content) => {
        const range = locate(content);
        if (!range) return content;
        replaced = true;
        return content.slice(0, range.start) + replacement + content.slice(range.end);
      });
    } catch (error) {
      throw noteUnavailable(error);
    }
    if (!replaced) throw new UploadError("reference-conflict", conflictMessage);
  }
}

/** Explains a paste upload that finished without inserting a hosted link. */
export function describeUnfinishedPaste(
  job: UploadJob,
  context: MarkdownReferenceContext,
): string {
  const reason = job.error?.message ?? "Unknown error.";
  if (job.result) {
    return `The image was uploaded, but its link could not be inserted: ${reason} Copy the link from the upload status view.`;
  }
  if (context.localImage) {
    return `Image upload failed: ${reason} The image was saved locally as ${context.localImage.path}.`;
  }
  return `Image upload failed: ${reason}`;
}

function noteUnavailable(cause: unknown): UploadError {
  return new UploadError(
    "reference-conflict",
    "The note was deleted or could not be updated before the upload finished.",
    { cause },
  );
}

function createAnchorToken(jobId: string): string {
  return `picbed-manager-upload:${jobId}`;
}

function createStatusMarker(token: string, text: string): string {
  return `⏳ ${escapeStatusText(text)} <!-- ${token} -->`;
}

/** Finds a placeholder: from its `⏳ ` to the end of the line with the token. */
function findStatusMarker(content: string, token: string): TextRange | undefined {
  const anchor = `<!-- ${token} -->`;
  const anchorOffset = content.indexOf(anchor);
  if (anchorOffset === -1) return undefined;

  const lineStart = content.lastIndexOf("\n", anchorOffset - 1) + 1;
  const lineEnd = content.indexOf("\n", anchorOffset + anchor.length);
  const end = lineEnd === -1 ? content.length : lineEnd;
  const statusStart = content.lastIndexOf("⏳ ", anchorOffset);
  if (statusStart < lineStart) return undefined;
  return { start: statusStart, end };
}

function findText(content: string, text: string): TextRange | undefined {
  const start = content.indexOf(text);
  return start === -1 ? undefined : { start, end: start + text.length };
}

function offsetToPosition(content: string, offset: number): EditorPosition {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length - 1,
    ch: lines[lines.length - 1]?.length ?? 0,
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
