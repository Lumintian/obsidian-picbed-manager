import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type PicbedManagerPlugin from "../main";
import { createId } from "../shared/id";
import { cloneDefaultProfile, type UploadProfile } from "./model";
import { validateProfile } from "./validation";

export class PicbedManagerSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: PicbedManagerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Picbed Manager" });

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

    new Setting(this.containerEl)
      .setName("Default profile")
      .addDropdown((dropdown) => {
        for (const profile of this.plugin.settings.profiles) {
          dropdown.addOption(profile.id, profile.name);
        }
        dropdown
          .setValue(this.plugin.settings.defaultProfileId)
          .onChange(async (value) => {
            this.plugin.settings.defaultProfileId = value;
            await this.plugin.saveState();
          });
      });

    for (const profile of this.plugin.settings.profiles) {
      this.renderProfile(profile);
    }

    new Setting(this.containerEl).addButton((button) =>
      button.setButtonText("Add profile").onClick(async () => {
        const profile = cloneDefaultProfile(createId("profile"));
        profile.name = `Profile ${this.plugin.settings.profiles.length + 1}`;
        this.plugin.settings.profiles.push(profile);
        await this.plugin.saveState();
        this.display();
      }),
    );
  }

  private renderProfile(profile: UploadProfile): void {
    this.containerEl.createEl("h3", { text: profile.name });

    this.addText(profile, "Profile name", "name", () => this.display());
    this.addText(profile, "API endpoint", "endpoint");
    this.addText(profile, "Multipart file field", "fileField");
    this.addText(profile, "Response URL path", "responseUrlPath");
    this.addText(profile, "Response asset ID path", "responseAssetIdPath");
    this.addText(
      profile,
      "Response delete descriptor path",
      "responseDeletePayloadPath",
    );

    new Setting(this.containerEl)
      .setName("Timeout (seconds)")
      .addText((text) =>
        text
          .setValue(String(profile.timeoutMs / 1_000))
          .onChange(async (value) => {
            const seconds = Number(value);
            if (Number.isFinite(seconds)) {
              profile.timeoutMs = Math.round(seconds * 1_000);
              await this.plugin.saveState();
            }
          }),
      );

    this.containerEl.createEl("h4", { text: "HTTP headers" });
    profile.headers.forEach((header, index) => {
      new Setting(this.containerEl)
        .addText((text) =>
          text.setPlaceholder("Header name").setValue(header.name).onChange(async (value) => {
            header.name = value;
            await this.plugin.saveState();
          }),
        )
        .addText((text) => {
          text.inputEl.type = header.secret ? "password" : "text";
          return text.setPlaceholder("Value").setValue(header.value).onChange(async (value) => {
            header.value = value;
            await this.plugin.saveState();
          });
        })
        .addToggle((toggle) =>
          toggle.setTooltip("Treat as secret").setValue(header.secret).onChange(async (value) => {
            header.secret = value;
            await this.plugin.saveState();
            this.display();
          }),
        )
        .addExtraButton((button) =>
          button.setIcon("trash").setTooltip("Remove header").onClick(async () => {
            profile.headers.splice(index, 1);
            await this.plugin.saveState();
            this.display();
          }),
        );
    });
    new Setting(this.containerEl).addButton((button) =>
      button.setButtonText("Add header").onClick(async () => {
        profile.headers.push({ name: "", value: "", secret: true });
        await this.plugin.saveState();
        this.display();
      }),
    );

    this.containerEl.createEl("h4", { text: "Extra form fields" });
    profile.extraFields.forEach((field, index) => {
      new Setting(this.containerEl)
        .addText((text) =>
          text.setPlaceholder("Field name").setValue(field.name).onChange(async (value) => {
            field.name = value;
            await this.plugin.saveState();
          }),
        )
        .addText((text) =>
          text.setPlaceholder("Value").setValue(field.value).onChange(async (value) => {
            field.value = value;
            await this.plugin.saveState();
          }),
        )
        .addExtraButton((button) =>
          button.setIcon("trash").setTooltip("Remove field").onClick(async () => {
            profile.extraFields.splice(index, 1);
            await this.plugin.saveState();
            this.display();
          }),
        );
    });
    new Setting(this.containerEl).addButton((button) =>
      button.setButtonText("Add form field").onClick(async () => {
        profile.extraFields.push({ name: "", value: "" });
        await this.plugin.saveState();
        this.display();
      }),
    );

    const actions = this.containerEl.createDiv({ cls: "picbed-manager-profile-actions" });
    const validate = actions.createEl("button", { text: "Validate profile" });
    validate.addEventListener("click", () => {
      const result = validateProfile(profile);
      new Notice(result.valid ? "Profile is valid." : result.errors.join("\n"));
    });

    if (this.plugin.settings.profiles.length > 1) {
      const remove = actions.createEl("button", { text: "Remove profile" });
      remove.addEventListener("click", () => {
        void this.plugin.removeProfile(profile.id).then(() => this.display());
      });
    }
  }

  private addText<K extends keyof UploadProfile>(
    profile: UploadProfile,
    name: string,
    key: K,
    afterChange?: () => void,
  ): void {
    new Setting(this.containerEl).setName(name).addText((text) =>
      text.setValue(String(profile[key])).onChange(async (value) => {
        profile[key] = value as UploadProfile[K];
        await this.plugin.saveState();
        afterChange?.();
      }),
    );
  }
}
