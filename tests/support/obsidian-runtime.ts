/**
 * Runtime stand-in for the `obsidian` package, which ships type declarations
 * only. Vitest aliases `obsidian` to this module so files importing Obsidian
 * classes can be loaded and measured; tests still provide their own fakes for
 * any behavior they exercise.
 */
export class Plugin {}

export class PluginSettingTab {}

export class Modal {}

export class Setting {}

export class Notice {}

export class MarkdownView {}

export function requestUrl(): never {
  throw new Error("requestUrl is not available in unit tests.");
}
