import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, Modal, MarkdownView, Menu, MenuItem, FileSystemAdapter } from 'obsidian';
import { readFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname, basename, relative } from 'path';

interface CrossVaultSettings {
	vaultMappings: Record<string, string>;
	enableLocalCopy: Record<string, boolean>;
}

const DEFAULT_SETTINGS: CrossVaultSettings = {
	vaultMappings: {},
	enableLocalCopy: {}
}

export default class CrossVaultPlugin extends Plugin {
	settings!: CrossVaultSettings;

	async onload() {
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new CrossVaultSettingTab(this.app, this));

		// Register context menu for obsidian:// links
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor, view) => {
				const selection = editor.getSelection();
				if (this.isObsidianLink(selection)) {
					menu.addItem((item: MenuItem) => {
						item
							.setTitle('Map vault')
							.setIcon('link')
							.onClick(() => {
								new VaultMappingModal(this.app, this, selection).open();
							});
					});
				}
			})
		);

		// Register link processor for obsidian:// URLs
		this.registerMarkdownPostProcessor((element, context) => {
			const links = element.querySelectorAll('a[href^="obsidian://"]');
			links.forEach((link) => {
				this.processObsidianLink(link as HTMLAnchorElement, context);
			});
		});

		// Add command to open cross-vault file
		this.addCommand({
			id: 'open-cross-vault-file',
			name: 'Open cross-vault file',
			callback: () => {
				new CrossVaultFileModal(this.app, this).open();
			}
		});
	}

	onunload() {
		// Cleanup if needed
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private isObsidianLink(text: string): boolean {
		return text.startsWith('obsidian://');
	}

	private parseObsidianUrl(url: string): { vault: string; file: string } | null {
		try {
			const urlObj = new URL(url);
			if (urlObj.protocol !== 'obsidian:' || urlObj.pathname !== '//open') {
				return null;
			}
			
			const params = urlObj.searchParams;
			const vault = params.get('vault');
			const file = params.get('file');
			
			if (!vault || !file) {
				return null;
			}
			
			return { vault, file: decodeURIComponent(file) };
		} catch (error) {
			return null;
		}
	}

	private async processObsidianLink(link: HTMLAnchorElement, context: any) {
		const url = link.href;
		const parsed = this.parseObsidianUrl(url);
		
		if (!parsed) {
			return;
		}

		const { vault, file } = parsed;
		const vaultPath = this.settings.vaultMappings[vault];
		
		if (!vaultPath) {
			// Show unmapped vault indicator
			link.addClass('cross-vault-unmapped');
			link.title = `Vault "${vault}" not mapped. Click to map.`;
			link.addEventListener('click', (e) => {
				e.preventDefault();
				new VaultMappingModal(this.app, this, url).open();
			});
			return;
		}

		// Try to resolve the file
		const resolvedFile = await this.resolveFile(vault, file, vaultPath);
		
		if (resolvedFile) {
			link.addClass('cross-vault-mapped');
			link.title = `Cross-vault link: ${vault}/${file}`;
			
			// Add hover preview
			this.addHoverPreview(link, resolvedFile, context);
			
			// Override click behavior
			link.addEventListener('click', (e) => {
				e.preventDefault();
				this.openCrossVaultFile(resolvedFile);
			});
		} else {
			link.addClass('cross-vault-missing');
			link.title = `File not found: ${vault}/${file}`;
		}
	}

	private async resolveFile(vault: string, file: string, vaultPath: string): Promise<string | null> {
		// First, try the original vault location
		const originalPath = join(vaultPath, file + '.md');
		if (existsSync(originalPath)) {
			return originalPath;
		}

		// If local copy is enabled, check local copy
		if (this.settings.enableLocalCopy[vault]) {
			const localCopyPath = this.getLocalCopyPath(vault, file);
			if (existsSync(localCopyPath)) {
				return localCopyPath;
			}
			
			// Try to create local copy if original exists
			if (existsSync(originalPath)) {
				try {
					await this.createLocalCopy(vault, file, originalPath);
					return localCopyPath;
				} catch (error) {
					console.error('Failed to create local copy:', error);
				}
			}
		}

		return null;
	}

	private getLocalCopyPath(vault: string, file: string): string {
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const vaultFolder = join((adapter as any).path, vault);
		return join(vaultFolder, file + '.md');
	}

	private async createLocalCopy(vault: string, file: string, sourcePath: string): Promise<void> {
		const localPath = this.getLocalCopyPath(vault, file);
		
		// Ensure directory exists
		mkdirSync(dirname(localPath), { recursive: true });
		
		// Copy file
		copyFileSync(sourcePath, localPath);
		
		new Notice(`Local copy created: ${vault}/${file}`);
	}

	private addHoverPreview(link: HTMLAnchorElement, filePath: string, context: any) {
		link.addEventListener('mouseenter', async () => {
			// Simple preview - could be enhanced with proper Obsidian preview
			try {
				const content = readFileSync(filePath, 'utf-8');
				const preview = content.substring(0, 200) + (content.length > 200 ? '...' : '');
				link.title = preview;
			} catch (error) {
				link.title = 'Error reading file';
			}
		});
	}

	private async openCrossVaultFile(filePath: string) {
		try {
			const content = readFileSync(filePath, 'utf-8');
			
			// Create a new view with the content
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(null as any); // This is a workaround for cross-vault files
			
			// Set the content manually
			const view = leaf.view as MarkdownView;
			if (view && view.editor) {
				view.editor.setValue(content);
				(view as any).titleEl?.setText(basename(filePath, '.md'));
			}
			
		} catch (error) {
			new Notice(`Error opening file: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	async addVaultMapping(vault: string, path: string) {
		this.settings.vaultMappings[vault] = path;
		await this.saveSettings();
		
		// Refresh all processed links
		this.app.workspace.updateOptions();
		new Notice(`Vault "${vault}" mapped to: ${path}`);
	}

	async toggleLocalCopy(vault: string, enabled: boolean) {
		this.settings.enableLocalCopy[vault] = enabled;
		await this.saveSettings();
	}
}

class CrossVaultSettingTab extends PluginSettingTab {
	plugin: CrossVaultPlugin;

	constructor(app: App, plugin: CrossVaultPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Cross Vault Settings' });

		// Add new vault mapping
		new Setting(containerEl)
			.setName('Add vault mapping')
			.setDesc('Map a vault name to its file system location')
			.addButton(button => {
				button
					.setButtonText('Add mapping')
					.onClick(() => {
						new VaultMappingModal(this.app, this.plugin, '').open();
					});
			});

		// Display existing mappings
		containerEl.createEl('h3', { text: 'Existing vault mappings' });
		
		Object.entries(this.plugin.settings.vaultMappings).forEach(([vault, path]) => {
			const setting = new Setting(containerEl)
				.setName(vault)
				.setDesc(path);

			// Local copy toggle
			setting.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.enableLocalCopy[vault] || false)
					.onChange(async (value) => {
						await this.plugin.toggleLocalCopy(vault, value);
					});
				toggle.toggleEl.title = 'Enable local copy for offline access';
			});

			// Remove button
			setting.addButton(button => {
				button
					.setButtonText('Remove')
					.onClick(async () => {
						delete this.plugin.settings.vaultMappings[vault];
						delete this.plugin.settings.enableLocalCopy[vault];
						await this.plugin.saveSettings();
						this.display(); // Refresh
					});
			});
		});
	}
}

class VaultMappingModal extends Modal {
	plugin: CrossVaultPlugin;
	obsidianUrl: string;
	vaultName: string = '';

	constructor(app: App, plugin: CrossVaultPlugin, obsidianUrl: string) {
		super(app);
		this.plugin = plugin;
		this.obsidianUrl = obsidianUrl;
		
		// Extract vault name from URL if provided
		if (obsidianUrl) {
			const parsed = this.parseObsidianUrl(obsidianUrl);
			this.vaultName = parsed?.vault || '';
		}
	}

	private parseObsidianUrl(url: string): { vault: string; file: string } | null {
		try {
			const urlObj = new URL(url);
			if (urlObj.protocol !== 'obsidian:' || urlObj.pathname !== '//open') {
				return null;
			}
			
			const params = urlObj.searchParams;
			const vault = params.get('vault');
			const file = params.get('file');
			
			if (!vault || !file) {
				return null;
			}
			
			return { vault, file: decodeURIComponent(file) };
		} catch (error) {
			return null;
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Map Vault Location' });

		let vaultNameInput: HTMLInputElement;
		let vaultPathInput: HTMLInputElement;

		new Setting(contentEl)
			.setName('Vault name')
			.setDesc('The name of the vault as it appears in obsidian:// URLs')
			.addText(text => {
				vaultNameInput = text.inputEl;
				text.setValue(this.vaultName)
					.setPlaceholder('e.g., Obsidian_Technology');
			});

		new Setting(contentEl)
			.setName('Vault path')
			.setDesc('Absolute or relative path to the vault folder')
			.addText(text => {
				vaultPathInput = text.inputEl;
				text.setPlaceholder('e.g., ../Obsidian_Technology or /path/to/vault');
			});

		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('Save mapping')
					.setCta()
					.onClick(async () => {
						const vaultName = vaultNameInput.value.trim();
						const vaultPath = vaultPathInput.value.trim();
						
						if (!vaultName || !vaultPath) {
							new Notice('Please fill in both vault name and path');
							return;
						}
						
						await this.plugin.addVaultMapping(vaultName, vaultPath);
						this.close();
					});
			})
			.addButton(button => {
				button
					.setButtonText('Cancel')
					.onClick(() => {
						this.close();
					});
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class CrossVaultFileModal extends Modal {
	plugin: CrossVaultPlugin;

	constructor(app: App, plugin: CrossVaultPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Open Cross-Vault File' });

		let vaultSelect: HTMLSelectElement;
		let fileInput: HTMLInputElement;

		// Vault selector
		new Setting(contentEl)
			.setName('Vault')
			.setDesc('Select the vault containing the file')
			.addDropdown(dropdown => {
				vaultSelect = dropdown.selectEl;
				dropdown.addOption('', 'Select a vault...');
				Object.keys(this.plugin.settings.vaultMappings).forEach(vault => {
					dropdown.addOption(vault, vault);
				});
			});

		// File input
		new Setting(contentEl)
			.setName('File name')
			.setDesc('Name of the file to open (without .md extension)')
			.addText(text => {
				fileInput = text.inputEl;
				text.setPlaceholder('e.g., Creating an ERP ring between NEC and Aviat');
			});

		// Action buttons
		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('Open file')
					.setCta()
					.onClick(async () => {
						const vault = vaultSelect.value;
						const fileName = fileInput.value.trim();
						
						if (!vault || !fileName) {
							new Notice('Please select a vault and enter a file name');
							return;
						}
						
						const vaultPath = this.plugin.settings.vaultMappings[vault];
						const resolvedFile = await this.plugin['resolveFile'](vault, fileName, vaultPath);
						
						if (resolvedFile) {
							await this.plugin['openCrossVaultFile'](resolvedFile);
							this.close();
						} else {
							new Notice(`File not found: ${vault}/${fileName}`);
						}
					});
			})
			.addButton(button => {
				button
					.setButtonText('Cancel')
					.onClick(() => {
						this.close();
					});
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
} 