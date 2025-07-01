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
			console.log('Processing element:', element);
			
			// Process existing anchor tags
			const links = element.querySelectorAll('a[href^="obsidian://"]');
			console.log('Found existing links:', links.length);
			links.forEach((link) => {
				this.processObsidianLink(link as HTMLAnchorElement, context);
			});

			// Process text content that contains obsidian:// URLs
			this.processTextNodes(element, context);
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
			console.log('Parsing URL:', url);
			
			// Handle both encoded and decoded URLs
			let decodedUrl = url;
			try {
				decodedUrl = decodeURIComponent(url);
			} catch (e) {
				console.log('URL was already decoded');
			}
			
			// Try different URL patterns
			let match = null;
			const patterns = [
				// Standard format
				/obsidian:\/\/open\?vault=([^&]+)&file=(.+?)(?:\.md)?$/,
				// Format without proper encoding
				/obsidian:\/\/open\?vault=([^&\s]+)\s*&\s*file=([^&\s]+)(?:\.md)?$/,
				// Format with spaces
				/obsidian:\/\/open\?\s*vault=([^&]+)\s*&\s*file=(.+?)(?:\.md)?$/,
				// Format with different parameter order
				/obsidian:\/\/open\?(?:file=(.+?)(?:\.md)?&vault=([^&]+)|vault=([^&]+)&file=(.+?)(?:\.md)?)$/
			];
			
			for (const pattern of patterns) {
				match = decodedUrl.match(pattern);
				if (match) {
					console.log('Matched pattern:', pattern);
					break;
				}
			}
			
			if (!match) {
				// Try to extract components manually
				const vaultMatch = decodedUrl.match(/vault=([^&\s]+)/);
				const fileMatch = decodedUrl.match(/file=([^&\s]+)/);
				
				if (vaultMatch && fileMatch) {
					match = [null, vaultMatch[1], fileMatch[1]];
				} else {
					console.log('URL did not match any expected format:', decodedUrl);
					return null;
				}
			}
			
			// Extract vault and file from matches
			let vault, file;
			if (match[3] !== undefined) {
				// Matched alternate parameter order
				vault = match[3];
				file = match[4];
			} else {
				vault = match[1];
				file = match[2];
			}
			
			if (!vault || !file) {
				console.log('Failed to extract vault or file from URL');
				return null;
			}
			
			// Clean up the components
			try {
				vault = decodeURIComponent(vault);
			} catch (e) {
				console.log('Vault name was already decoded');
			}
			
			try {
				file = decodeURIComponent(file);
			} catch (e) {
				console.log('File path was already decoded');
			}
			
			// Normalize the file path
			file = file
				.replace(/\.md$/, '') // Remove .md extension if present
				.replace(/[\\\/]+/g, '/') // Normalize path separators
				.replace(/\s+/g, ' ') // Normalize spaces
				.replace(/%20/g, ' '); // Convert %20 to spaces
			
			console.log('Parsed URL components:', { vault, file });
			
			return { vault, file };
		} catch (error) {
			console.error('Error parsing obsidian URL:', error);
			return null;
		}
	}

	private async processObsidianLink(link: HTMLAnchorElement, context: any) {
		// Get the original href without decoding first
		const url = link.getAttribute('href') || '';
		console.log('Processing URL:', url);
		
		// Clean up the URL if needed
		const cleanUrl = url
			.replace(/\s+/g, '') // Remove any whitespace
			.replace(/obsidian:\/\/open\?/, 'obsidian://open?') // Fix protocol format
			.replace(/&amp;/g, '&'); // Fix HTML entities
		
		console.log('Cleaned URL:', cleanUrl);
		
		const parsed = this.parseObsidianUrl(cleanUrl);
		console.log('Parsed URL:', parsed);
		
		if (!parsed) {
			console.log('Failed to parse URL');
			return;
		}

		const { vault, file } = parsed;
		const vaultPath = this.settings.vaultMappings[vault];
		console.log('Vault mapping:', { vault, vaultPath });
		
		// Remove any existing classes
		link.classList.remove('cross-vault-unmapped');
		link.classList.remove('cross-vault-mapped');
		link.classList.remove('cross-vault-missing');
		
		// Remove existing event listeners by cloning the node
		const newLink = link.cloneNode(true) as HTMLAnchorElement;
		link.parentNode?.replaceChild(newLink, link);
		link = newLink;
		
		if (!vaultPath) {
			// Show unmapped vault indicator
			link.classList.add('cross-vault-unmapped');
			link.title = `Vault "${vault}" not mapped. Click to map.`;
			link.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				new VaultMappingModal(this.app, this, url).open();
			});
			return;
		}

		// Try to resolve the file
		const resolvedFile = await this.resolveFile(vault, file, vaultPath);
		
		if (resolvedFile) {
			link.classList.add('cross-vault-mapped');
			link.title = `Cross-vault link: ${vault}/${file}`;
			
			// Add hover preview
			this.addHoverPreview(link, resolvedFile, context);
			
			// Override click behavior
			link.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.openCrossVaultFile(resolvedFile);
			});
		} else {
			link.classList.add('cross-vault-missing');
			link.title = `File not found: ${vault}/${file}`;
		}
	}

	private async resolveFile(vault: string, file: string, vaultPath: string): Promise<string | null> {
		try {
			// Normalize the vault path and file name
			const normalizedVaultPath = vaultPath.replace(/[\\/]+/g, '/');
			const normalizedFile = file.replace(/[\\/]+/g, '/');
			
			// Try various path combinations
			const possiblePaths = [
				join(normalizedVaultPath, normalizedFile + '.md'),
				join(normalizedVaultPath, normalizedFile),
				join(normalizedVaultPath, normalizedFile, 'index.md'),
				// Try with spaces encoded as %20
				join(normalizedVaultPath, normalizedFile.replace(/%20/g, ' ') + '.md'),
				join(normalizedVaultPath, normalizedFile.replace(/%20/g, ' ')),
				// Try with different case variations
				join(normalizedVaultPath, normalizedFile.toLowerCase() + '.md'),
				join(normalizedVaultPath, normalizedFile.toUpperCase() + '.md')
			];

			// Log for debugging
			console.log('Attempting to resolve file:', {
				vault,
				file,
				vaultPath,
				normalizedVaultPath,
				normalizedFile,
				possiblePaths
			});

			// Check each possible path
			for (const path of possiblePaths) {
				if (existsSync(path)) {
					console.log('Found file at:', path);
					return path;
				}
			}

			// If local copy is enabled, check local copy
			if (this.settings.enableLocalCopy[vault]) {
				const localCopyPath = this.getLocalCopyPath(vault, file);
				if (existsSync(localCopyPath)) {
					console.log('Found local copy at:', localCopyPath);
					return localCopyPath;
				}
				
				// Try to create local copy if original exists
				const originalPath = possiblePaths[0];
				if (existsSync(originalPath)) {
					try {
						await this.createLocalCopy(vault, file, originalPath);
						return localCopyPath;
					} catch (error) {
						console.error('Failed to create local copy:', error);
					}
				}
			}

			console.log('File not found in any location');
			return null;
		} catch (error) {
			console.error('Error resolving file:', error);
			return null;
		}
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
			console.log('Opening file:', filePath);
			
			if (!existsSync(filePath)) {
				throw new Error(`File not found: ${filePath}`);
			}

			// Try to open the file directly using the app's file system
			const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
			if (abstractFile && abstractFile instanceof TFile) {
				await this.app.workspace.getLeaf(true).openFile(abstractFile);
				return;
			}

			// If direct opening fails, fall back to manual content loading
			const content = readFileSync(filePath, 'utf-8');
			console.log('File content loaded, length:', content.length);
			
			// Create a new view with the content
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(null as any);
			
			// Set the content manually
			const view = leaf.view as MarkdownView;
			if (view && view.editor) {
				view.editor.setValue(content);
				(view as any).titleEl?.setText(basename(filePath, '.md'));
				
				// Set the view mode to preview if it's markdown
				if (filePath.toLowerCase().endsWith('.md')) {
					await (view as any).setState({ ...view.getState(), mode: 'preview' });
				}
			}
			
		} catch (error) {
			console.error('Error opening file:', error);
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

	private processTextNodes(element: HTMLElement, context: any) {
		// Get all text content and check for obsidian:// URLs
		const textContent = element.textContent || '';
		if (!textContent.includes('obsidian://')) {
			return;
		}

		console.log('Processing text nodes in element with content containing obsidian://', element);

		// Use a more comprehensive approach to find and replace URLs
		const obsidianUrlRegex = /obsidian:\/\/open\?[^\s<>)"']+/g;
		
		// Process all text nodes recursively
		this.replaceTextWithLinks(element, obsidianUrlRegex, context);
	}

	private replaceTextWithLinks(node: Node, regex: RegExp, context: any) {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent || '';
			const matches = Array.from(text.matchAll(regex));
			
			if (matches.length > 0) {
				console.log('Found URLs in text node:', matches.map(m => m[0]));
				
				const fragment = document.createDocumentFragment();
				let lastIndex = 0;
				
				matches.forEach((match) => {
					const url = match[0];
					const startIndex = match.index!;
					
					// Add text before the URL
					if (startIndex > lastIndex) {
						fragment.appendChild(
							document.createTextNode(text.slice(lastIndex, startIndex))
						);
					}
					
					// Create and process the link
					const link = document.createElement('a');
					link.href = url;
					link.textContent = url;
					link.style.color = 'var(--link-color)';
					link.style.textDecoration = 'underline';
					
					// Process the link to add our functionality
					setTimeout(() => {
						this.processObsidianLink(link, context);
					}, 0);
					
					fragment.appendChild(link);
					lastIndex = startIndex + url.length;
				});
				
				// Add remaining text
				if (lastIndex < text.length) {
					fragment.appendChild(
						document.createTextNode(text.slice(lastIndex))
					);
				}
				
				// Replace the text node with the fragment
				node.parentNode?.replaceChild(fragment, node);
			}
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			// Skip already processed links and certain elements
			const element = node as HTMLElement;
			if (element.tagName === 'A' || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') {
				return;
			}
			
			// Process child nodes (make a copy since we might modify the DOM)
			const children = Array.from(node.childNodes);
			children.forEach(child => {
				this.replaceTextWithLinks(child, regex, context);
			});
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

		// Display column descriptions
		const descContainer = containerEl.createDiv('vault-mappings-description');
		descContainer.createEl('h3', { text: 'Vault Mappings' });
		
		const descList = descContainer.createEl('ul');
		descList.createEl('li', { text: 'Vault Name: The name that appears in obsidian:// URLs (e.g., Obsidian_Technology)' });
		descList.createEl('li', { text: 'Path: Absolute or relative path to the vault folder' });
		descList.createEl('li', { text: 'Local Copy: Enable to keep a local backup of referenced files' });
		descList.createEl('li', { text: 'Actions: Edit or remove the vault mapping' });

		// Create table header
		const table = containerEl.createEl('table', { cls: 'vault-mappings-table' });
		const header = table.createEl('tr');
		header.createEl('th', { text: 'Vault Name' });
		header.createEl('th', { text: 'Path' });
		header.createEl('th', { text: 'Local Copy' });
		header.createEl('th', { text: 'Actions' });

		// Display existing mappings
		Object.entries(this.plugin.settings.vaultMappings).forEach(([vault, path]) => {
			const row = table.createEl('tr');

			// Vault name cell (editable)
			const nameCell = row.createEl('td');
			const nameInput = nameCell.createEl('input', {
				type: 'text',
				value: vault,
				cls: 'vault-name-input'
			});
			nameInput.addEventListener('change', async () => {
				const newName = nameInput.value.trim();
				if (newName && newName !== vault) {
					// Update mappings with new vault name
					this.plugin.settings.vaultMappings[newName] = this.plugin.settings.vaultMappings[vault];
					this.plugin.settings.enableLocalCopy[newName] = this.plugin.settings.enableLocalCopy[vault];
					delete this.plugin.settings.vaultMappings[vault];
					delete this.plugin.settings.enableLocalCopy[vault];
					await this.plugin.saveSettings();
					this.display(); // Refresh
				}
			});

			// Path cell (editable)
			const pathCell = row.createEl('td');
			const pathInput = pathCell.createEl('input', {
				type: 'text',
				value: path,
				cls: 'vault-path-input'
			});
			pathInput.addEventListener('change', async () => {
				const newPath = pathInput.value.trim();
				if (newPath) {
					this.plugin.settings.vaultMappings[vault] = newPath;
					await this.plugin.saveSettings();
				}
			});

			// Local copy toggle cell
			const toggleCell = row.createEl('td');
			const toggleContainer = toggleCell.createEl('div', { cls: 'vault-toggle-container' });
			const toggle = new Setting(toggleContainer)
				.addToggle(toggle => {
					toggle
						.setValue(this.plugin.settings.enableLocalCopy[vault] || false)
						.onChange(async (value) => {
							await this.plugin.toggleLocalCopy(vault, value);
						});
					toggle.toggleEl.title = 'Enable local copy for offline access';
				});

			// Actions cell
			const actionsCell = row.createEl('td');
			const actionsContainer = actionsCell.createEl('div', { cls: 'vault-actions-container' });
			
			// Remove button
			const removeBtn = actionsContainer.createEl('button', {
				text: 'Remove',
				cls: 'vault-remove-btn'
			});
			removeBtn.addEventListener('click', async () => {
				delete this.plugin.settings.vaultMappings[vault];
				delete this.plugin.settings.enableLocalCopy[vault];
				await this.plugin.saveSettings();
				this.display(); // Refresh
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
			console.log('Parsing URL:', url);
			
			// Handle both encoded and decoded URLs
			let decodedUrl = url;
			try {
				decodedUrl = decodeURIComponent(url);
			} catch (e) {
				console.log('URL was already decoded');
			}
			
			// Try different URL patterns
			let match = null;
			const patterns = [
				// Standard format
				/obsidian:\/\/open\?vault=([^&]+)&file=(.+?)(?:\.md)?$/,
				// Format without proper encoding
				/obsidian:\/\/open\?vault=([^&\s]+)\s*&\s*file=([^&\s]+)(?:\.md)?$/,
				// Format with spaces
				/obsidian:\/\/open\?\s*vault=([^&]+)\s*&\s*file=(.+?)(?:\.md)?$/,
				// Format with different parameter order
				/obsidian:\/\/open\?(?:file=(.+?)(?:\.md)?&vault=([^&]+)|vault=([^&]+)&file=(.+?)(?:\.md)?)$/
			];
			
			for (const pattern of patterns) {
				match = decodedUrl.match(pattern);
				if (match) {
					console.log('Matched pattern:', pattern);
					break;
				}
			}
			
			if (!match) {
				// Try to extract components manually
				const vaultMatch = decodedUrl.match(/vault=([^&\s]+)/);
				const fileMatch = decodedUrl.match(/file=([^&\s]+)/);
				
				if (vaultMatch && fileMatch) {
					match = [null, vaultMatch[1], fileMatch[1]];
				} else {
					console.log('URL did not match any expected format:', decodedUrl);
					return null;
				}
			}
			
			// Extract vault and file from matches
			let vault, file;
			if (match[3] !== undefined) {
				// Matched alternate parameter order
				vault = match[3];
				file = match[4];
			} else {
				vault = match[1];
				file = match[2];
			}
			
			if (!vault || !file) {
				console.log('Failed to extract vault or file from URL');
				return null;
			}
			
			// Clean up the components
			try {
				vault = decodeURIComponent(vault);
			} catch (e) {
				console.log('Vault name was already decoded');
			}
			
			try {
				file = decodeURIComponent(file);
			} catch (e) {
				console.log('File path was already decoded');
			}
			
			// Normalize the file path
			file = file
				.replace(/\.md$/, '') // Remove .md extension if present
				.replace(/[\\\/]+/g, '/') // Normalize path separators
				.replace(/\s+/g, ' ') // Normalize spaces
				.replace(/%20/g, ' '); // Convert %20 to spaces
			
			console.log('Parsed URL components:', { vault, file });
			
			return { vault, file };
		} catch (error) {
			console.error('Error parsing obsidian URL:', error);
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