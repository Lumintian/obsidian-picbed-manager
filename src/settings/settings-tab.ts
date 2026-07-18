import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type PicbedManagerPlugin from "../main";
import { createId } from "../shared/id";
import { cloneDefaultProfile, type UploadProfile } from "./model";
import {
  PROFILE_CONFIGURATION_STEPS,
  PROFILE_FIELD_HELP,
  type ProfileFieldHelp,
} from "./profile-help";
import { validateProfile } from "./validation";

const PROFILE_TABS_ARIA_LABEL = "Upload profiles";

export class PicbedManagerSettingTab extends PluginSettingTab {
  private selectedProfileId = "";

  constructor(
    app: App,
    private readonly plugin: PicbedManagerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.ensureSelectedProfile();
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Picbed Manager" });

    this.renderBehaviorSettings();
    this.renderProfileGuide();
    this.renderProfileTabs();

    const selected = this.getSelectedProfile();
    if (selected) {
      const panel = this.containerEl.createDiv({
        cls: "picbed-manager-profile-panel",
        attr: {
          role: "tabpanel",
          "aria-label": `${selected.name} profile settings`,
        },
      });
      this.renderProfile(selected, panel);
    }
  }

  private renderBehaviorSettings(): void {
    this.containerEl.createEl("h3", { text: "Upload behavior" });

    new Setting(this.containerEl)
      .setName("Upload pasted images")
      .setDesc("Automatically upload a single image pasted into a Markdown note.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.behavior.autoUploadOnPaste)
          .onChange(async (value) => {
            this.plugin.settings.behavior.autoUploadOnPaste = value;
            await this.plugin.saveState();
          }),
      );

    new Setting(this.containerEl)
      .setName("Preserve file name as alt text")
      .setDesc("Use the pasted file name as the Markdown image alt text.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.behavior.preserveAltText)
          .onChange(async (value) => {
            this.plugin.settings.behavior.preserveAltText = value;
            await this.plugin.saveState();
          }),
      );

    new Setting(this.containerEl)
      .setName("Automatic retry count")
      .setDesc("Retries only timeout, network, and server-side failures.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 5, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.behavior.retryCount)
          .onChange(async (value) => {
            this.plugin.settings.behavior.retryCount = value;
            await this.plugin.saveState();
          }),
      );
  }

  private renderProfileGuide(): void {
    const guide = this.containerEl.createEl("details", {
      cls: "picbed-manager-profile-guide",
    });
    guide.createEl("summary", { text: "How to map your image host API" });
    guide.createEl("p", {
      text: "Picbed Manager sends one multipart/form-data POST request and reads the public URL from the JSON response.",
    });
    const steps = guide.createEl("ol");
    for (const step of PROFILE_CONFIGURATION_STEPS) {
      steps.createEl("li", { text: step });
    }
    const example = guide.createDiv({ cls: "picbed-manager-api-example" });
    example.createEl("strong", { text: "Example mapping" });
    example.createEl("pre").createEl("code", {
      text: '{\n  "data": {\n    "url": "https://img.example/a.png",\n    "id": "asset-123"\n  }\n}',
    });
    example.createEl("p", {
      text: "Object response: data.url · Single-item array response: publicUrl or 0.publicUrl",
    });
    example.createEl("pre").createEl("code", {
      text: '[\n  {\n    "src": "/file/example.jpg",\n    "publicUrl": "https://img.example/example.jpg"\n  }\n]',
    });
  }

  private renderProfileTabs(): void {
    const heading = this.containerEl.createDiv({ cls: "picbed-manager-profile-heading" });
    heading.createEl("h3", { text: "Upload profiles" });
    const add = heading.createEl("button", {
      text: "Add profile",
      cls: "mod-cta",
      attr: { type: "button" },
    });
    add.addEventListener("click", () => {
      void this.addProfile();
    });

    const tabs = this.containerEl.createDiv({
      cls: "picbed-manager-profile-tabs",
      attr: { role: "tablist", "aria-label": PROFILE_TABS_ARIA_LABEL },
    });
    for (const profile of this.plugin.settings.profiles) {
      const selected = profile.id === this.selectedProfileId;
      const button = tabs.createEl("button", {
        text: profile.name,
        cls: selected ? "is-active" : "",
        attr: {
          type: "button",
          role: "tab",
          "aria-selected": String(selected),
          title: profile.name,
        },
      });
      button.addEventListener("click", () => {
        if (this.selectedProfileId === profile.id) return;
        this.selectedProfileId = profile.id;
        this.display();
      });
    }
  }

  private renderProfile(profile: UploadProfile, panel: HTMLElement): void {
    const title = panel.createDiv({ cls: "picbed-manager-profile-title" });
    const titleText = title.createEl("h3", { text: profile.name });
    if (profile.id === this.plugin.settings.defaultProfileId) {
      title.createEl("span", { text: "Default", cls: "picbed-manager-badge" });
    } else {
      const makeDefault = title.createEl("button", {
        text: "Set as default",
        attr: { type: "button" },
      });
      makeDefault.addEventListener("click", () => {
        void this.setDefaultProfile(profile.id);
      });
    }

    this.addProfileText(panel, profile, "name", (value) => {
      titleText.setText(value || "Unnamed profile");
      this.updateSelectedTabLabel(value || "Unnamed profile");
    });
    this.addProfileText(panel, profile, "endpoint");
    this.addProfileText(panel, profile, "fileField");
    this.addProfileText(panel, profile, "responseUrlPath");
    this.addProfileText(panel, profile, "responseUrlBase");
    this.addProfileText(
      panel,
      profile,
      "responseAssetIdPath",
    );
    this.addProfileText(
      panel,
      profile,
      "responseDeletePayloadPath",
    );

    const timeoutHelp = PROFILE_FIELD_HELP.timeout;
    new Setting(panel)
      .setName(formatFieldLabel(timeoutHelp))
      .setDesc(formatDescription(timeoutHelp))
      .addText((text) =>
        text
          .setPlaceholder(timeoutHelp.example ?? "")
          .setValue(String(profile.timeoutMs / 1_000))
          .onChange(async (value) => {
            const seconds = Number(value);
            if (Number.isFinite(seconds)) {
              profile.timeoutMs = Math.round(seconds * 1_000);
              await this.plugin.saveState();
            }
          }),
      );

    this.renderHeaders(panel, profile);
    this.renderExtraFields(panel, profile);
    this.renderProfileActions(panel, profile);
  }

  private renderHeaders(panel: HTMLElement, profile: UploadProfile): void {
    const help = PROFILE_FIELD_HELP.headers;
    panel.createEl("h4", { text: formatFieldLabel(help) });
    panel.createEl("p", {
      text: help.description,
      cls: "setting-item-description picbed-manager-section-description",
    });

    profile.headers.forEach((header, index) => {
      new Setting(panel)
        .addText((text) =>
          text
            .setPlaceholder("Header name, e.g. Authorization")
            .setValue(header.name)
            .onChange(async (value) => {
              header.name = value;
              await this.plugin.saveState();
            }),
        )
        .addText((text) => {
          text.inputEl.type = header.secret ? "password" : "text";
          return text
            .setPlaceholder("Header value")
            .setValue(header.value)
            .onChange(async (value) => {
              header.value = value;
              await this.plugin.saveState();
            });
        })
        .addToggle((toggle) =>
          toggle
            .setTooltip("Hide this credential in the settings and redact it from errors")
            .setValue(header.secret)
            .onChange(async (value) => {
              header.secret = value;
              await this.plugin.saveState();
              this.display();
            }),
        )
        .addExtraButton((button) =>
          button
            .setIcon("trash")
            .setTooltip("Remove header")
            .onClick(async () => {
              profile.headers.splice(index, 1);
              await this.plugin.saveState();
              this.display();
            }),
        );
    });
    new Setting(panel).addButton((button) =>
      button.setButtonText("Add header").onClick(async () => {
        profile.headers.push({ name: "", value: "", secret: true });
        await this.plugin.saveState();
        this.display();
      }),
    );
  }

  private renderExtraFields(panel: HTMLElement, profile: UploadProfile): void {
    const help = PROFILE_FIELD_HELP.extraFields;
    panel.createEl("h4", { text: formatFieldLabel(help) });
    panel.createEl("p", {
      text: help.description,
      cls: "setting-item-description picbed-manager-section-description",
    });

    profile.extraFields.forEach((field, index) => {
      new Setting(panel)
        .addText((text) =>
          text
            .setPlaceholder("Field name, e.g. album")
            .setValue(field.name)
            .onChange(async (value) => {
              field.name = value;
              await this.plugin.saveState();
            }),
        )
        .addText((text) =>
          text
            .setPlaceholder("Field value")
            .setValue(field.value)
            .onChange(async (value) => {
              field.value = value;
              await this.plugin.saveState();
            }),
        )
        .addExtraButton((button) =>
          button
            .setIcon("trash")
            .setTooltip("Remove field")
            .onClick(async () => {
              profile.extraFields.splice(index, 1);
              await this.plugin.saveState();
              this.display();
            }),
        );
    });
    new Setting(panel).addButton((button) =>
      button.setButtonText("Add form field").onClick(async () => {
        profile.extraFields.push({ name: "", value: "" });
        await this.plugin.saveState();
        this.display();
      }),
    );
  }

  private renderProfileActions(panel: HTMLElement, profile: UploadProfile): void {
    const actions = panel.createDiv({ cls: "picbed-manager-profile-actions" });
    const validate = actions.createEl("button", {
      text: "Validate profile",
      cls: "mod-cta",
      attr: { type: "button" },
    });
    validate.addEventListener("click", () => {
      const result = validateProfile(profile);
      new Notice(result.valid ? "Profile is valid." : result.errors.join("\n"));
    });

    if (this.plugin.settings.profiles.length > 1) {
      const remove = actions.createEl("button", {
        text: "Remove profile",
        attr: { type: "button" },
      });
      remove.addEventListener("click", () => {
        void this.removeProfile(profile.id);
      });
    }
  }

  private addProfileText(
    panel: HTMLElement,
    profile: UploadProfile,
    key: EditableProfileTextKey,
    afterChange?: (value: string) => void,
  ): void {
    const help = PROFILE_FIELD_HELP[key];
    new Setting(panel)
      .setName(formatFieldLabel(help))
      .setDesc(formatDescription(help))
      .addText((text) =>
        text
          .setPlaceholder(help.example ?? "")
          .setValue(profile[key])
          .onChange(async (value) => {
            profile[key] = value;
            afterChange?.(value);
            await this.plugin.saveState();
          }),
      );
  }

  private async addProfile(): Promise<void> {
    const profile = cloneDefaultProfile(createId("profile"));
    profile.name = `Profile ${this.plugin.settings.profiles.length + 1}`;
    this.plugin.settings.profiles.push(profile);
    this.selectedProfileId = profile.id;
    await this.plugin.saveState();
    this.display();
  }

  private async removeProfile(profileId: string): Promise<void> {
    const index = this.plugin.settings.profiles.findIndex(
      (profile) => profile.id === profileId,
    );
    await this.plugin.removeProfile(profileId);
    const profiles = this.plugin.settings.profiles;
    this.selectedProfileId = profiles[Math.min(index, profiles.length - 1)]?.id ?? "";
    this.display();
  }

  private async setDefaultProfile(profileId: string): Promise<void> {
    this.plugin.settings.defaultProfileId = profileId;
    await this.plugin.saveState();
    this.display();
  }

  private ensureSelectedProfile(): void {
    const exists = this.plugin.settings.profiles.some(
      (profile) => profile.id === this.selectedProfileId,
    );
    if (!exists) {
      this.selectedProfileId =
        this.plugin.settings.defaultProfileId ||
        this.plugin.settings.profiles[0]?.id ||
        "";
    }
  }

  private getSelectedProfile(): UploadProfile | undefined {
    return this.plugin.settings.profiles.find(
      (profile) => profile.id === this.selectedProfileId,
    );
  }

  private updateSelectedTabLabel(label: string): void {
    const selected = this.containerEl.querySelector<HTMLButtonElement>(
      '.picbed-manager-profile-tabs [role="tab"][aria-selected="true"]',
    );
    selected?.setText(label);
    selected?.setAttribute("title", label);
  }
}

type EditableProfileTextKey =
  | "name"
  | "endpoint"
  | "fileField"
  | "responseUrlPath"
  | "responseUrlBase"
  | "responseAssetIdPath"
  | "responseDeletePayloadPath";

function formatFieldLabel(help: ProfileFieldHelp): string {
  return `${help.label} · ${help.required ? "Required" : "Optional"}`;
}

function formatDescription(help: ProfileFieldHelp): string {
  return help.example
    ? `${help.description} Example: ${help.example}`
    : help.description;
}
