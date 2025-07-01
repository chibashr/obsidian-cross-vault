# Cross Vault Linker

An Obsidian plugin that enables seamless linking and previewing of notes across multiple vaults stored in local or relative locations.

## Features

### 🔗 Cross-Vault Linking
- Process `obsidian://` URLs that reference other vaults
- Visual indicators for mapped and unmapped vaults
- Click to open cross-vault references
- Context menu support for quick vault mapping

### 👀 Live Previews
- Hover over cross-vault links to see content previews
- Display file content from external vaults
- Visual indicators for cached vs. non-cached files

### 📁 Local File Caching
- Optional copying of referenced files to current vault
- Offline access to external vault content
- Automatic cache management and updates

### ⚙️ Flexible Settings
- Browse button for easy vault path selection
- Configurable vault mappings with descriptions
- Default copy-locally behavior
- Edit and delete existing mappings

## Usage

### Setting Up Vault Mappings

1. Go to Settings → Cross Vault Linker
2. Click "Add New Vault Mapping"
3. Enter the vault name as it appears in obsidian:// URLs
4. Browse to or enter the local path to that vault
5. Optionally enable "Copy Locally" for offline access
6. Add a description for reference

### Mapping from Links

1. Select an `obsidian://` link in your editor
2. Right-click and choose "Map Vault"
3. Configure the vault location in the dialog
4. The plugin will remember this mapping for future use

### Example Workflow

Given an obsidian link like:
```
obsidian://open?vault=MyProject&file=Meeting%20Notes
```

1. The plugin will look for a vault mapping named "MyProject"
2. If mapped, it will display the file with visual indicators
3. Hover to preview the content
4. Click to open the file (or local copy if cached)
5. If unmapped, the link shows an error state with quick mapping options

## Settings

### Default Copy Locally
When enabled, new vault mappings will default to copying files locally for offline access.

### Vault Mappings
- **Name**: The vault name as it appears in obsidian:// URLs
- **Path**: Local file system path to the vault
- **Copy Locally**: Whether to cache files from this vault
- **Description**: Optional description for organization

## Installation

### Manual Installation
1. Download the plugin files
2. Create a folder in `.obsidian/plugins/` called `obsidian-cross-vault`
3. Copy the plugin files into this folder
4. Enable the plugin in Obsidian's Community Plugins settings

### Development
```bash
npm install
npm run dev
```

### Building
```bash
npm run build
```

## Technical Details

- **Desktop Only**: This plugin requires file system access and is not compatible with mobile versions
- **File Types**: Supports .md and .txt files with automatic extension detection
- **Path Resolution**: Handles URL encoding and various file naming conventions
- **Error Handling**: Graceful fallbacks for missing files or unmapped vaults

## License

MIT License

## Contributing

Contributions are welcome! Please submit issues and pull requests to help improve the plugin.

## Privacy

This plugin operates entirely locally and does not transmit any data externally. All vault mappings and cached files remain on your local system. 