import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	Modal,
	Notice,
	Menu,
	MarkdownView,
	Component,
	MarkdownRenderer,
	normalizePath
} from 'obsidian';

import * as path from 'path';
import * as fs from 'fs';

interface VaultMapping {
	name: string;
	path: string;
	copyLocally: boolean;
	description?: string;
}

interface CrossVaultSettings {
	vaultMappings: VaultMapping[];
	defaultCopyLocally: boolean;
}

const DEFAULT_SETTINGS: CrossVaultSettings = {
	vaultMappings: [],
	defaultCopyLocally: false
};

export default class CrossVaultPlugin extends Plugin {
	settings: CrossVaultSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new CrossVaultSettingTab(this.app, this));

		// Register link processor for obsidian:// URLs
		this.registerMarkdownPostProcessor((element, context) => {
			this.processObsidianLinks(element, context);
		});

		// Add context menu for obsidian:// links
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (view instanceof MarkdownView) {
					this.addContextMenu(menu, editor, view);
				}
			})
		);

		// Add command to manually map a vault
		this.addCommand({
			id: 'map-vault',
			name: 'Map Vault from Selection',
			editorCallback: (editor, view) => {
				const selection = editor.getSelection();
				if (this.isObsidianLink(selection)) {
					this.openVaultMappingModal(selection);
				} else {
					new Notice('Please select an obsidian:// link first');
				}
			}
		});

		console.log('Cross Vault Plugin loaded');
	}

	onunload() {
		console.log('Cross Vault Plugin unloaded');
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

	private parseObsidianLink(url: string): { vault: string; file: string } | null {
		try {
			const urlObj = new URL(url);
			if (urlObj.protocol !== 'obsidian:' || urlObj.hostname !== 'open') {
				return null;
			}

			const vault = urlObj.searchParams.get('vault');
			const file = urlObj.searchParams.get('file');

			if (!vault || !file) {
				return null;
			}

			return { vault, file: decodeURIComponent(file) };
		} catch (error) {
			return null;
		}
	}

	private getVaultMapping(vaultName: string): VaultMapping | null {
		return this.settings.vaultMappings.find(mapping => mapping.name === vaultName) || null;
	}

	private async processObsidianLinks(element: HTMLElement, context: any) {
		const links = element.querySelectorAll('a[href^="obsidian://"]');
		
		for (let i = 0; i < links.length; i++) {
			const link = links[i] as HTMLAnchorElement;
			await this.processObsidianLink(link, context);
		}
	}

	private async processObsidianLink(link: HTMLAnchorElement, context: any) {
		const href = link.getAttribute('href');
		if (!href) return;

		const parsed = this.parseObsidianLink(href);
		if (!parsed) return;

		const mapping = this.getVaultMapping(parsed.vault);
		
		// Add styling to indicate it's a cross-vault link
		link.addClass('cross-vault-link');

		// Add click handler
		link.addEventListener('click', (e) => {
			e.preventDefault();
			this.handleObsidianLinkClick(parsed, mapping);
		});

		// Add preview on hover
		link.addEventListener('mouseenter', (e) => {
			this.showPreview(link, parsed, mapping);
		});

		// Update link text to show vault info
		if (mapping) {
			const cached = await this.isFileCached(parsed.vault, parsed.file);
			const indicator = cached ? 
				`<span class="cross-vault-cached-indicator" title="Cached locally"></span>` : 
				`<span class="cross-vault-offline-indicator" title="Not cached">⚠</span>`;
			
			if (!link.innerHTML.includes('cross-vault')) {
				link.innerHTML = `${link.innerHTML} (${parsed.vault})${indicator}`;
			}
		} else {
			if (!link.innerHTML.includes('unmapped')) {
				link.innerHTML = `${link.innerHTML} <span class="cross-vault-error" title="Vault not mapped">(unmapped: ${parsed.vault})</span>`;
			}
		}
	}

	private async handleObsidianLinkClick(parsed: { vault: string; file: string }, mapping: VaultMapping | null) {
		if (!mapping) {
			new Notice(`Vault "${parsed.vault}" is not mapped. Please configure it in settings.`);
			return;
		}

		try {
			const filePath = await this.resolveFilePath(mapping, parsed.file);
			if (filePath && await this.fileExists(filePath)) {
				// Try to open the file in current vault if it was copied locally
				if (mapping.copyLocally) {
					const localPath = this.getLocalCopyPath(parsed.vault, parsed.file);
					const localFile = this.app.vault.getAbstractFileByPath(localPath);
					if (localFile instanceof TFile) {
						await this.app.workspace.getLeaf().openFile(localFile);
						return;
					}
				}

				// Open external file (this would require additional implementation)
				new Notice(`Opening external file: ${parsed.file} from ${parsed.vault}`);
			} else {
				new Notice(`File not found: ${parsed.file} in vault ${parsed.vault}`);
			}
		} catch (error: any) {
			console.error('Error opening cross-vault file:', error);
			new Notice(`Error opening file: ${error.message}`);
		}
	}

	private async showPreview(link: HTMLAnchorElement, parsed: { vault: string; file: string }, mapping: VaultMapping | null) {
		if (!mapping) return;

		// Remove existing preview
		const existingPreview = document.querySelector('.cross-vault-preview');
		if (existingPreview) {
			existingPreview.remove();
		}

		try {
			const content = await this.getFileContent(mapping, parsed.file);
			if (content) {
				const preview = this.createPreviewElement(parsed, content);
				document.body.appendChild(preview);

				// Position the preview
				const rect = link.getBoundingClientRect();
				preview.style.position = 'absolute';
				preview.style.left = `${rect.left}px`;
				preview.style.top = `${rect.bottom + 5}px`;
				preview.style.zIndex = '1000';

				// Remove preview on mouse leave
				const removePreview = () => {
					preview.remove();
					link.removeEventListener('mouseleave', removePreview);
				};
				link.addEventListener('mouseleave', removePreview);
			}
		} catch (error) {
			console.error('Error showing preview:', error);
		}
	}

	private createPreviewElement(parsed: { vault: string; file: string }, content: string): HTMLElement {
		const preview = document.createElement('div');
		preview.className = 'cross-vault-preview';

		const header = document.createElement('div');
		header.className = 'cross-vault-preview-header';
		header.textContent = `${parsed.file} (${parsed.vault})`;

		const contentEl = document.createElement('div');
		contentEl.className = 'cross-vault-preview-content';
		
		// Render markdown content (simplified version)
		const truncatedContent = content.substring(0, 500) + (content.length > 500 ? '...' : '');
		contentEl.textContent = truncatedContent;

		preview.appendChild(header);
		preview.appendChild(contentEl);

		return preview;
	}

	private async resolveFilePath(mapping: VaultMapping, fileName: string): Promise<string | null> {
		try {
			// Handle different file name formats
			const normalizedFileName = fileName.replace(/%20/g, ' ');
			const possibleExtensions = ['', '.md', '.txt'];
			
			for (const ext of possibleExtensions) {
				const fullPath = path.join(mapping.path, normalizedFileName + ext);
				if (await this.fileExists(fullPath)) {
					return fullPath;
				}
			}

			return null;
		} catch (error) {
			console.error('Error resolving file path:', error);
			return null;
		}
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			return fs.existsSync(filePath);
		} catch (error) {
			return false;
		}
	}

	private async getFileContent(mapping: VaultMapping, fileName: string): Promise<string | null> {
		try {
			const filePath = await this.resolveFilePath(mapping, fileName);
			if (!filePath) return null;

			// Check local cache first
			if (mapping.copyLocally) {
				const cachedContent = await this.getCachedContent(mapping.name, fileName);
				if (cachedContent) return cachedContent;
			}

			// Read from source vault
			const content = fs.readFileSync(filePath, 'utf8');
			
			// Cache locally if enabled
			if (mapping.copyLocally) {
				await this.cacheFile(mapping.name, fileName, content);
			}

			return content;
		} catch (error) {
			console.error('Error reading file content:', error);
			return null;
		}
	}

	private getLocalCopyPath(vaultName: string, fileName: string): string {
		return normalizePath(`${vaultName}/${fileName}`);
	}

	private async isFileCached(vaultName: string, fileName: string): Promise<boolean> {
		const localPath = this.getLocalCopyPath(vaultName, fileName);
		const file = this.app.vault.getAbstractFileByPath(localPath);
		return file instanceof TFile;
	}

	private async getCachedContent(vaultName: string, fileName: string): Promise<string | null> {
		try {
			const localPath = this.getLocalCopyPath(vaultName, fileName);
			const file = this.app.vault.getAbstractFileByPath(localPath);
			if (file instanceof TFile) {
				return await this.app.vault.read(file);
			}
			return null;
		} catch (error) {
			return null;
		}
	}

	private async cacheFile(vaultName: string, fileName: string, content: string): Promise<void> {
		try {
			const localPath = this.getLocalCopyPath(vaultName, fileName);
			const folder = path.dirname(localPath);
			
			// Create folder if it doesn't exist
			if (!await this.app.vault.adapter.exists(folder)) {
				await this.app.vault.createFolder(folder);
			}

			// Create or update the file
			const existingFile = this.app.vault.getAbstractFileByPath(localPath);
			if (existingFile instanceof TFile) {
				await this.app.vault.modify(existingFile, content);
			} else {
				await this.app.vault.create(localPath, content);
			}
		} catch (error) {
			console.error('Error caching file:', error);
		}
	}

	private addContextMenu(menu: Menu, editor: any, view: MarkdownView) {
		const selection = editor.getSelection();
		if (this.isObsidianLink(selection)) {
			menu.addItem((item) => {
				item
					.setTitle('Map Vault')
					.setIcon('link')
					.onClick(() => {
						this.openVaultMappingModal(selection);
					});
			});
		}
	}

	private openVaultMappingModal(obsidianUrl: string) {
		const parsed = this.parseObsidianLink(obsidianUrl);
		if (!parsed) {
			new Notice('Invalid obsidian:// URL');
			return;
		}

		new VaultMappingModal(this.app, this, parsed.vault).open();
	}
}

class VaultMappingModal extends Modal {
	plugin: CrossVaultPlugin;
	vaultName: string;
	pathInput!: HTMLInputElement;
	copyLocallyToggle!: HTMLInputElement;
	descriptionInput!: HTMLInputElement;

	constructor(app: App, plugin: CrossVaultPlugin, vaultName: string) {
		super(app);
		this.plugin = plugin;
		this.vaultName = vaultName;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('cross-vault-modal');

		contentEl.createEl('h2', { text: `Map Vault: ${this.vaultName}` });

		const content = contentEl.createDiv('cross-vault-modal-content');

		// Vault path setting
		const pathRow = content.createDiv('cross-vault-modal-row');
		pathRow.createEl('label', { text: 'Vault Path:' });
		this.pathInput = pathRow.createEl('input', { type: 'text' });
		const browseBtn = pathRow.createEl('button', { text: 'Browse' });
		
		browseBtn.addEventListener('click', async () => {
			// Note: File dialog functionality requires additional setup for desktop apps
			// For now, users can manually enter the path
			new Notice('Please manually enter the vault path. Browse functionality requires additional desktop integration.');
		});

		// Copy locally setting
		const copyRow = content.createDiv('cross-vault-modal-row');
		copyRow.createEl('label', { text: 'Copy Locally:' });
		this.copyLocallyToggle = copyRow.createEl('input', { type: 'checkbox' });
		this.copyLocallyToggle.checked = this.plugin.settings.defaultCopyLocally;

		// Description setting
		const descRow = content.createDiv('cross-vault-modal-row');
		descRow.createEl('label', { text: 'Description:' });
		this.descriptionInput = descRow.createEl('input', { type: 'text' });

		// Buttons
		const buttonRow = content.createDiv('cross-vault-modal-row');
		const saveBtn = buttonRow.createEl('button', { text: 'Save' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });

		saveBtn.addEventListener('click', () => {
			this.save();
		});

		cancelBtn.addEventListener('click', () => {
			this.close();
		});
	}

	protected async save() {
		const path = this.pathInput.value.trim();
		if (!path) {
			new Notice('Please enter a vault path');
			return;
		}

		const mapping: VaultMapping = {
			name: this.vaultName,
			path: path,
			copyLocally: this.copyLocallyToggle.checked,
			description: this.descriptionInput.value.trim()
		};

		// Update or add mapping
		const existingIndex = this.plugin.settings.vaultMappings.findIndex(m => m.name === this.vaultName);
		if (existingIndex >= 0) {
			this.plugin.settings.vaultMappings[existingIndex] = mapping;
		} else {
			this.plugin.settings.vaultMappings.push(mapping);
		}

		await this.plugin.saveSettings();
		new Notice(`Vault "${this.vaultName}" mapped successfully`);
		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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

		// Default copy locally setting
		new Setting(containerEl)
			.setName('Default Copy Locally')
			.setDesc('Default setting for copying files locally when mapping new vaults')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.defaultCopyLocally)
				.onChange(async (value) => {
					this.plugin.settings.defaultCopyLocally = value;
					await this.plugin.saveSettings();
				}));

		// Vault mappings section
		containerEl.createEl('h3', { text: 'Vault Mappings' });
		containerEl.createEl('p', { 
			text: 'Configure mappings between vault names in obsidian:// URLs and their local paths.'
		});

		const mappingsContainer = containerEl.createDiv();
		this.displayVaultMappings(mappingsContainer);

		// Add new mapping button
		new Setting(containerEl)
			.addButton(button => button
				.setButtonText('Add New Vault Mapping')
				.setCta()
				.onClick(() => {
					new VaultMappingModal(this.app, this.plugin, '').open();
					// Refresh display after modal closes
					setTimeout(() => this.display(), 100);
				}));
	}

	private displayVaultMappings(container: HTMLElement) {
		container.empty();

		if (this.plugin.settings.vaultMappings.length === 0) {
			container.createEl('p', { 
				text: 'No vault mappings configured. Add a mapping using the button below or by right-clicking on an obsidian:// link.',
				cls: 'setting-item-description'
			});
			return;
		}

		this.plugin.settings.vaultMappings.forEach((mapping, index) => {
			const item = container.createDiv('cross-vault-settings-vault-item');

			const nameEl = item.createDiv('cross-vault-settings-vault-name');
			nameEl.textContent = mapping.name;

			const pathEl = item.createDiv('cross-vault-settings-vault-path');
			pathEl.textContent = mapping.path;
			if (mapping.description) {
				pathEl.title = mapping.description;
			}

			const buttonsEl = item.createDiv('cross-vault-settings-buttons');

			// Copy locally indicator
			if (mapping.copyLocally) {
				const copyIndicator = buttonsEl.createEl('span', { 
					text: '📁', 
					title: 'Copies files locally'
				});
			}

			// Edit button
			const editBtn = buttonsEl.createEl('button', { text: 'Edit' });
			editBtn.addEventListener('click', () => {
				new EditVaultMappingModal(this.app, this.plugin, mapping, index).open();
				setTimeout(() => this.display(), 100);
			});

			// Delete button
			const deleteBtn = buttonsEl.createEl('button', { text: 'Delete' });
			deleteBtn.style.color = 'var(--text-error)';
			deleteBtn.addEventListener('click', async () => {
				this.plugin.settings.vaultMappings.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
				new Notice(`Vault mapping "${mapping.name}" deleted`);
			});
		});
	}
}

class EditVaultMappingModal extends VaultMappingModal {
	mapping: VaultMapping;
	index: number;

	constructor(app: App, plugin: CrossVaultPlugin, mapping: VaultMapping, index: number) {
		super(app, plugin, mapping.name);
		this.mapping = mapping;
		this.index = index;
	}

	onOpen() {
		super.onOpen();
		
		// Pre-fill with existing values
		this.pathInput.value = this.mapping.path;
		this.copyLocallyToggle.checked = this.mapping.copyLocally;
		this.descriptionInput.value = this.mapping.description || '';
	}

	protected async save() {
		const path = this.pathInput.value.trim();
		if (!path) {
			new Notice('Please enter a vault path');
			return;
		}

		this.mapping.path = path;
		this.mapping.copyLocally = this.copyLocallyToggle.checked;
		this.mapping.description = this.descriptionInput.value.trim();

		await this.plugin.saveSettings();
		new Notice(`Vault "${this.mapping.name}" updated successfully`);
		this.close();
	}
} 