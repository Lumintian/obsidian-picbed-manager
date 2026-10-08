import { MarkdownView, moment } from "obsidian";
import type { App, Editor, TFile } from "obsidian";
import type { MarkdownNoteAccess } from "./markdown-adapter";

/** Reads and edits notes through the Obsidian workspace and vault. */
export function createObsidianNoteAccess(app: App): MarkdownNoteAccess {
  return {
    findEditor(note: TFile, preferred: Editor): Editor | undefined {
      let fallback: Editor | undefined;
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || view.file?.path !== note.path) {
          continue;
        }
        if (view.editor === preferred) return preferred;
        fallback ??= view.editor;
      }
      return fallback;
    },

    read: (note) => app.vault.read(note),

    process: (note, update) => app.vault.process(note, update),

    async saveAttachment(note, fileName, bytes) {
      const path = await app.fileManager.getAvailablePathForAttachment(
        pastedImageName(fileName),
        note.path,
      );
      const file = await app.vault.createBinary(path, bytes);
      return {
        path: file.path,
        embed: `!${app.fileManager.generateMarkdownLink(file, note.path)}`,
      };
    },
  };
}

/** Names the file the way Obsidian names a pasted image. */
function pastedImageName(fileName: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1] ?? "png";
  return `Pasted image ${moment().format("YYYYMMDDHHmmss")}.${extension}`;
}
