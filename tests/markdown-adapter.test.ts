import { describe, expect, it } from "vitest";
import type { Editor, EditorPosition, TFile } from "obsidian";
import { UploadError } from "../src/domain/errors";
import type { UploadJob } from "../src/domain/upload-job";
import {
  describeUnfinishedPaste,
  MarkdownReferenceAdapter,
  type MarkdownNoteAccess,
  type MarkdownReferenceContext,
} from "../src/references/markdown-adapter";

class FakeEditor {
  constructor(public value = "") {}

  replaceSelection(replacement: string): void {
    this.value += replacement;
  }

  getValue(): string {
    return this.value;
  }

  replaceRange(replacement: string, from: EditorPosition, to: EditorPosition): void {
    const start = this.offset(from);
    const end = this.offset(to);
    this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
  }

  private offset(position: EditorPosition): number {
    const lines = this.value.split("\n");
    let offset = 0;
    for (let line = 0; line < position.line; line += 1) {
      offset += (lines[line]?.length ?? 0) + 1;
    }
    return offset + position.ch;
  }
}

/**
 * Models open editors and note files. Like Obsidian, a tab reuses its editor
 * when it switches to another note, and the previous note is saved to disk.
 */
class FakeNotes implements MarkdownNoteAccess {
  readonly showing = new Map<FakeEditor, string>();
  readonly disk = new Map<string, string>();
  readonly attachments: { path: string; bytes: ArrayBuffer }[] = [];
  saveFails = false;

  open(editor: FakeEditor, path: string): void {
    const previous = this.showing.get(editor);
    if (previous) this.disk.set(previous, editor.value);
    editor.value = this.disk.get(path) ?? "";
    this.showing.set(editor, path);
  }

  findEditor(note: TFile, preferred: Editor): Editor | undefined {
    const editors = [...this.showing]
      .filter(([, path]) => path === note.path)
      .map(([editor]) => editor as unknown as Editor);
    return editors.includes(preferred) ? preferred : editors[0];
  }

  async read(note: TFile): Promise<string> {
    const content = this.disk.get(note.path);
    if (content === undefined) throw new Error(`${note.path} does not exist.`);
    return content;
  }

  async process(note: TFile, update: (content: string) => string): Promise<string> {
    const updated = update(await this.read(note));
    this.disk.set(note.path, updated);
    return updated;
  }

  async saveAttachment(
    _note: TFile,
    _fileName: string,
    bytes: ArrayBuffer,
  ): Promise<{ path: string; embed: string }> {
    if (this.saveFails) throw new Error("Disk full.");
    const path = `attachments/Pasted image ${this.attachments.length + 1}.png`;
    this.attachments.push({ path, bytes });
    return { path, embed: `![[${path}]]` };
  }
}

const note = { path: "Note.md" } as TFile;
const bytes = new Uint8Array([1, 2, 3]).buffer;

const job: UploadJob = {
  id: "job-1",
  source: {
    sourceId: "source-1",
    fileName: "image.png",
    bytes,
    origin: "paste",
  },
  profileId: "default",
  status: "queued",
  attempts: 0,
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

const uploaded = {
  url: "https://img.test/a.png",
  profileId: "default",
  uploadedAt: "2026-07-18T00:00:00.000Z",
};

const offline = new UploadError("network", "Connection failed.");

function setup(content = "before ") {
  const notes = new FakeNotes();
  notes.disk.set(note.path, content);
  const editor = new FakeEditor();
  notes.open(editor, note.path);
  const adapter = new MarkdownReferenceAdapter(notes);
  const context: MarkdownReferenceContext = {
    editor: editor as unknown as Editor,
    note,
    altText: "image.png",
  };
  const anchor = adapter.insertPending(context, job);
  return { notes, editor, adapter, context, anchor };
}

describe("MarkdownReferenceAdapter", () => {
  it("uses a non-resource-loading text marker", () => {
    const { editor } = setup();

    expect(editor.value).toContain("⏳ Uploading image.png…");
    expect(editor.value).toContain("<!-- picbed-manager-upload:job-1 -->");
    expect(editor.value).not.toContain("![](");
  });

  it("replaces only its unique pending marker", async () => {
    const { editor, adapter, context, anchor } = setup();
    editor.value += " and unrelated text";

    await adapter.commit(context, anchor, {
      ...uploaded,
      url: "https://img.test/a (1).png",
    });

    expect(editor.value).toBe(
      "before ![image.png](https://img.test/a%20%281%29.png)",
    );
  });

  it("detects an edited or removed marker", async () => {
    const { editor, adapter, context, anchor } = setup();
    editor.value = "marker removed";

    await expect(adapter.commit(context, anchor, uploaded)).rejects.toMatchObject({
      code: "reference-conflict",
    });
  });

  it("inserts the link into the note file after the tab switches notes", async () => {
    const { notes, editor, adapter, context, anchor } = setup();
    notes.disk.set("Other.md", "other note");
    notes.open(editor, "Other.md");

    await adapter.commit(context, anchor, uploaded);

    expect(notes.disk.get(note.path)).toBe("before ![image.png](https://img.test/a.png)");
    expect(editor.value).toBe("other note");
  });

  it("uses another editor that shows the note", async () => {
    const { notes, editor, adapter, context, anchor } = setup();
    notes.open(editor, "Other.md");
    const other = new FakeEditor();
    notes.open(other, note.path);
    other.value += "\nunsaved edit";

    await adapter.commit(context, anchor, uploaded);

    expect(other.value).toBe(
      "before ![image.png](https://img.test/a.png)\nunsaved edit",
    );
  });

  it("reports a deleted note as a reference conflict", async () => {
    const { notes, editor, adapter, context, anchor } = setup();
    notes.open(editor, "Other.md");
    notes.disk.delete(note.path);

    await expect(adapter.commit(context, anchor, uploaded)).rejects.toMatchObject({
      code: "reference-conflict",
      message: "The note was deleted or could not be updated before the upload finished.",
    });
  });

  it("saves a failed upload as a local attachment", async () => {
    const { notes, editor, adapter, context, anchor } = setup();

    await adapter.fail(context, anchor, offline, job);

    expect(notes.attachments).toEqual([
      { path: "attachments/Pasted image 1.png", bytes },
    ]);
    expect(editor.value).toBe("before ![[attachments/Pasted image 1.png]]");
    expect(context.localImage?.path).toBe("attachments/Pasted image 1.png");
  });

  it("replaces the local image with the hosted link when a retry succeeds", async () => {
    const { editor, adapter, context, anchor } = setup();
    await adapter.fail(context, anchor, offline, job);

    await adapter.commit(context, anchor, uploaded);

    expect(editor.value).toBe("before ![image.png](https://img.test/a.png)");
    expect(context.localImage).toBeUndefined();
  });

  it("keeps the first local copy when a retry fails again", async () => {
    const { notes, editor, adapter, context, anchor } = setup();
    await adapter.fail(context, anchor, offline, job);

    await adapter.fail(context, anchor, offline, job);

    expect(notes.attachments).toHaveLength(1);
    expect(editor.value).toBe("before ![[attachments/Pasted image 1.png]]");
  });

  it("does not save an image whose placeholder was removed", async () => {
    const { notes, editor, adapter, context, anchor } = setup();
    editor.value = "placeholder deleted";

    await expect(adapter.fail(context, anchor, offline, job)).rejects.toMatchObject({
      code: "reference-conflict",
    });
    expect(notes.attachments).toEqual([]);
  });

  it("falls back to a failure marker when the image cannot be saved", async () => {
    const { notes, editor, adapter, context, anchor } = setup();
    notes.saveFails = true;

    await adapter.fail(context, anchor, offline, job);

    expect(editor.value).toContain("Upload failed: image.png — Connection failed.");
    expect(editor.value).toContain("<!-- picbed-manager-upload:job-1 -->");
    expect(context.localImage).toBeUndefined();
  });
});

describe("describeUnfinishedPaste", () => {
  const context = { editor: {} as Editor, note, altText: "" };

  it("points to the status view when the image was uploaded", () => {
    expect(
      describeUnfinishedPaste({ ...job, result: uploaded, error: offline }, context),
    ).toBe(
      "The image was uploaded, but its link could not be inserted: Connection failed. Copy the link from the upload status view.",
    );
  });

  it("names the local copy of a failed upload", () => {
    expect(
      describeUnfinishedPaste(
        { ...job, error: offline },
        { ...context, localImage: { path: "a/Pasted image.png", embed: "" } },
      ),
    ).toBe(
      "Image upload failed: Connection failed. The image was saved locally as a/Pasted image.png.",
    );
  });

  it("reports a plain failure", () => {
    expect(describeUnfinishedPaste({ ...job, error: offline }, context)).toBe(
      "Image upload failed: Connection failed.",
    );
  });
});
