import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, requestUrl, Menu, Editor, MarkdownView, Component } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';

interface VaultMapping {
	name: string;
	path: string;
	enableLocalCache: boolean;
}

interface CrossVaultSettings {
	vaultMappings: VaultMapping[];
}

const DEFAULT_SETTINGS: CrossVaultSettings = {
	vaultMappings: []
};

interface ObsidianUrl {
	vault: string;
	file: string;
	originalUrl: string;
}

export default class CrossVaultPlugin extends Plugin {
	settings!: CrossVaultSettings;

	async onload() {
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new CrossVaultSettingTab(this.app, this));

		// Register context menu for obsidian:// links
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
				const selection = editor.getSelection();
				if (this.isObsidianUrl(selection)) {
					menu.addItem((item) => {
						item.setTitle('Map Vault')
							.setIcon('folder-plus')
							.onClick(() => {
								const parsedUrl = this.parseObsidianUrl(selection);
								if (parsedUrl) {
									this.showVaultMappingDialog(parsedUrl);
								}
							});
					});
				}
			})
		);

		// Register markdown processor for obsidian:// links
		this.registerMarkdownProcessor();

		// Register command to refresh cross-vault links
		this.addCommand({
			id: 'refresh-cross-vault-links',
			name: 'Refresh Cross-Vault Links',
			callback: () => {
				this.refreshCurrentNote();
			}
		});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private registerMarkdownProcessor() {
		this.registerMarkdownPostProcessor((element, context) => {
			const links = element.querySelectorAll('a[href^="obsidian://"]');
			links.forEach((link) => {
				this.processObsidianLink(link as HTMLAnchorElement, context);
			});
		});
	}

	private async processObsidianLink(linkElement: HTMLAnchorElement, context: any) {
		const url = linkElement.href;
		const parsedUrl = this.parseObsidianUrl(url);
		
		if (!parsedUrl) return;

		const vaultMapping = this.getVaultMapping(parsedUrl.vault);
		
		if (!vaultMapping) {
			this.addUnmappedVaultIndicator(linkElement, parsedUrl.vault);
			return;
		}

		try {
			const fileContent = await this.getFileFromVault(vaultMapping, parsedUrl.file);
			if (fileContent) {
				this.enhanceObsidianLink(linkElement, parsedUrl, vaultMapping, fileContent);
			} else {
				this.addErrorIndicator(linkElement, 'File not found');
			}
		} catch (error) {
			this.addErrorIndicator(linkElement, 'Error loading file');
		}
	}

	private enhanceObsidianLink(linkElement: HTMLAnchorElement, parsedUrl: ObsidianUrl, vaultMapping: VaultMapping, fileContent: string) {
		// Add status indicator
		const statusSpan = document.createElement('span');
		statusSpan.className = 'cross-vault-status';
		statusSpan.textContent = '✓';
		statusSpan.title = `Linked to: ${vaultMapping.path}`;
		linkElement.appendChild(statusSpan);

		// Create preview on hover
		linkElement.addEventListener('mouseenter', () => {
			this.showPreview(linkElement, fileContent, parsedUrl.file);
		});

		// Handle click to open file
		linkElement.addEventListener('click', (e) => {
			e.preventDefault();
			this.openCrossVaultFile(vaultMapping, parsedUrl.file, fileContent);
		});
	}

	private addUnmappedVaultIndicator(linkElement: HTMLAnchorElement, vaultName: string) {
		const statusSpan = document.createElement('span');
		statusSpan.className = 'cross-vault-status cross-vault-error';
		statusSpan.textContent = '?';
		statusSpan.title = `Vault "${vaultName}" not mapped. Click to map.`;
		statusSpan.addEventListener('click', () => {
			this.showVaultMappingDialog({ vault: vaultName, file: '', originalUrl: linkElement.href });
		});
		linkElement.appendChild(statusSpan);
	}

	private addErrorIndicator(linkElement: HTMLAnchorElement, message: string) {
		const statusSpan = document.createElement('span');
		statusSpan.className = 'cross-vault-status cross-vault-error';
		statusSpan.textContent = '✗';
		statusSpan.title = message;
		linkElement.appendChild(statusSpan);
	}

	private showPreview(element: HTMLElement, content: string, fileName: string) {
		const preview = document.createElement('div');
		preview.className = 'cross-vault-preview';
		preview.innerHTML = `
			<strong>${fileName}</strong><br>
			${content.substring(0, 200)}${content.length > 200 ? '...' : ''}
		`;
		
		const rect = element.getBoundingClientRect();
		preview.style.position = 'absolute';
		preview.style.top = `${rect.bottom + 5}px`;
		preview.style.left = `${rect.left}px`;
		preview.style.zIndex = '1000';
		preview.style.maxWidth = '300px';
		
		document.body.appendChild(preview);
		
		const removePreview = () => {
			if (preview.parentNode) {
				preview.parentNode.removeChild(preview);
			}
		};
		
		element.addEventListener('mouseleave', removePreview);
		setTimeout(removePreview, 5000); // Auto-remove after 5 seconds
	}

	private async openCrossVaultFile(vaultMapping: VaultMapping, fileName: string, content: string) {
		if (vaultMapping.enableLocalCache) {
			// Save to local cache and open
			await this.cacheFileLocally(vaultMapping.name, fileName, content);
		}
		
		// Try to open the original vault file
		try {
			const originalPath = path.join(vaultMapping.path, fileName + '.md');
			if (fs.existsSync(originalPath)) {
				// Open in system default app or show notice
				new Notice(`Opening file from ${vaultMapping.name}: ${fileName}`);
				// Note: Direct file opening depends on system capabilities
			}
		} catch (error) {
			new Notice(`Cannot open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	private async cacheFileLocally(vaultName: string, fileName: string, content: string) {
		try {
			const adapter = this.app.vault.adapter as any;
			const basePath = adapter.basePath || adapter.path || '';
			const cacheDir = path.join(basePath, vaultName);
			
			// Create cache directory if it doesn't exist
			if (!fs.existsSync(cacheDir)) {
				fs.mkdirSync(cacheDir, { recursive: true });
			}
			
			const localPath = path.join(cacheDir, fileName + '.md');
			fs.writeFileSync(localPath, content);
			
			new Notice(`File cached locally: ${vaultName}/${fileName}`);
		} catch (error) {
			new Notice(`Failed to cache file: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	private async getFileFromVault(vaultMapping: VaultMapping, fileName: string): Promise<string | null> {
		try {
			const filePath = path.join(vaultMapping.path, fileName + '.md');
			
			if (fs.existsSync(filePath)) {
				return fs.readFileSync(filePath, 'utf8');
			}
			
			// Try without .md extension
			const filePathWithoutExt = path.join(vaultMapping.path, fileName);
			if (fs.existsSync(filePathWithoutExt)) {
				return fs.readFileSync(filePathWithoutExt, 'utf8');
			}
			
			return null;
		} catch (error) {
			console.error('Error reading file from vault:', error);
			return null;
		}
	}

	private parseObsidianUrl(url: string): ObsidianUrl | null {
		try {
			const urlObj = new URL(url);
			if (urlObj.protocol !== 'obsidian:') return null;
			
			const vault = urlObj.searchParams.get('vault');
			const file = urlObj.searchParams.get('file');
			
			if (!vault || !file) return null;
			
			return {
				vault: decodeURIComponent(vault),
				file: decodeURIComponent(file),
				originalUrl: url
			};
		} catch (error) {
			return null;
		}
	}

	private isObsidianUrl(text: string): boolean {
		return text.startsWith('obsidian://');
	}

	private getVaultMapping(vaultName: string): VaultMapping | null {
		return this.settings.vaultMappings.find(mapping => mapping.name === vaultName) || null;
	}

	private async showVaultMappingDialog(parsedUrl: ObsidianUrl) {
		const modal = new VaultMappingModal(this.app, this, parsedUrl);
		modal.open();
	}

	private refreshCurrentNote() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			activeView.previewMode.rerender(true);
			new Notice('Cross-vault links refreshed');
		}
	}

	addVaultMapping(mapping: VaultMapping) {
		// Remove existing mapping with same name
		this.settings.vaultMappings = this.settings.vaultMappings.filter(m => m.name !== mapping.name);
		this.settings.vaultMappings.push(mapping);
		this.saveSettings();
	}

	removeVaultMapping(name: string) {
		this.settings.vaultMappings = this.settings.vaultMappings.filter(m => m.name !== name);
		this.saveSettings();
	}
}

class VaultMappingModal extends Component {
	plugin: CrossVaultPlugin;
	parsedUrl: ObsidianUrl;
	modal: any;

	constructor(app: App, plugin: CrossVaultPlugin, parsedUrl: ObsidianUrl) {
		super();
		this.plugin = plugin;
		this.parsedUrl = parsedUrl;
	}

	open() {
		// Simple prompt for now - in a real implementation, you'd create a proper modal
		const vaultPath = prompt(`Enter the path for vault "${this.parsedUrl.vault}":`);
		if (vaultPath) {
			const mapping: VaultMapping = {
				name: this.parsedUrl.vault,
				path: vaultPath,
				enableLocalCache: false
			};
			this.plugin.addVaultMapping(mapping);
			new Notice(`Vault "${this.parsedUrl.vault}" mapped successfully`);
		}
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
		containerEl.className = 'cross-vault-settings';

		containerEl.createEl('h2', { text: 'Cross Vault Navigator Settings' });

		containerEl.createEl('h3', { text: 'Vault Mappings' });
		
		const mappingsContainer = containerEl.createDiv();
		this.displayVaultMappings(mappingsContainer);

		new Setting(containerEl)
			.setName('Add New Vault')
			.setDesc('Map a new vault for cross-vault linking')
			.addButton(button => {
				button.setButtonText('Add Vault')
					.setClass('add-vault-button')
					.onClick(() => {
						this.showAddVaultDialog();
					});
			});
	}

	private displayVaultMappings(container: HTMLElement) {
		container.empty();
		
		this.plugin.settings.vaultMappings.forEach((mapping, index) => {
			const mappingDiv = container.createDiv({ cls: 'vault-mapping' });
			
			const nameInput = mappingDiv.createEl('input', { type: 'text', value: mapping.name });
			nameInput.placeholder = 'Vault Name';
			nameInput.addEventListener('blur', () => {
				mapping.name = nameInput.value;
				this.plugin.saveSettings();
			});
			
			const pathInput = mappingDiv.createEl('input', { type: 'text', value: mapping.path });
			pathInput.placeholder = 'Vault Path';
			pathInput.addEventListener('blur', () => {
				mapping.path = pathInput.value;
				this.plugin.saveSettings();
			});
			
			const browseButton = mappingDiv.createEl('button', { text: 'Browse', cls: 'browse-button' });
			browseButton.addEventListener('click', () => {
				// Note: File browsing would require additional implementation
				new Notice('File browsing not implemented in this demo. Please enter path manually.');
			});
			
			const cacheCheckbox = mappingDiv.createEl('input', { type: 'checkbox' });
			cacheCheckbox.checked = mapping.enableLocalCache;
			cacheCheckbox.addEventListener('change', () => {
				mapping.enableLocalCache = cacheCheckbox.checked;
				this.plugin.saveSettings();
			});
			
			const cacheLabel = mappingDiv.createEl('label', { text: 'Enable Local Cache' });
			cacheLabel.prepend(cacheCheckbox);
			
			const deleteButton = mappingDiv.createEl('button', { text: 'Delete' });
			deleteButton.addEventListener('click', () => {
				this.plugin.removeVaultMapping(mapping.name);
				this.display(); // Refresh the display
			});
		});
	}

	private showAddVaultDialog() {
		const name = prompt('Enter vault name:');
		if (!name) return;
		
		const path = prompt('Enter vault path:');
		if (!path) return;
		
		const mapping: VaultMapping = {
			name,
			path,
			enableLocalCache: false
		};
		
		this.plugin.addVaultMapping(mapping);
		this.display(); // Refresh the display
		new Notice(`Vault "${name}" added successfully`);
	}
} 