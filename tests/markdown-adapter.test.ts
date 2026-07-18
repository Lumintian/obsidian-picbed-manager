import { describe, expect, it } from "vitest";
import type { Editor, EditorPosition } from "obsidian";
import { UploadError } from "../src/domain/errors";
import { MarkdownReferenceAdapter } from "../src/references/markdown-adapter";

class FakeEditor {
  value = "before ";

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

const job = {
  id: "job-1",
  source: {
    sourceId: "source-1",
    fileName: "image.png",
    bytes: new ArrayBuffer(0),
    origin: "paste" as const,
  },
  profileId: "default",
  status: "queued" as const,
  attempts: 0,
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

describe("MarkdownReferenceAdapter", () => {
  it("replaces only its unique pending reference", async () => {
    const editor = new FakeEditor();
    const adapter = new MarkdownReferenceAdapter();
    const context = { editor: editor as unknown as Editor, altText: "image.png" };
    const anchor = adapter.insertPending(context, job);
    editor.value += " and unrelated text";

    await adapter.commit(context, anchor, {
      url: "https://img.test/a (1).png",
      profileId: "default",
      uploadedAt: "2026-07-18T00:00:00.000Z",
    });

    expect(editor.value).toBe(
      "before ![image.png](https://img.test/a%20%281%29.png) and unrelated text",
    );
  });

  it("detects an edited or removed marker", async () => {
    const editor = new FakeEditor();
    const adapter = new MarkdownReferenceAdapter();
    const context = { editor: editor as unknown as Editor, altText: "image.png" };
    const anchor = adapter.insertPending(context, job);
    editor.value = "marker removed";

    await expect(
      adapter.commit(context, anchor, {
        url: "https://img.test/a.png",
        profileId: "default",
        uploadedAt: "2026-07-18T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(UploadError);
  });
});
