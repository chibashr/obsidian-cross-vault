# Cross Vault Linker

A plugin for Obsidian that enables linking and previewing pages across different vaults stored locally or at relative locations.

## Features

- **Cross-vault linking**: Link to files in other Obsidian vaults using `obsidian://` URLs
- **Visual indicators**: Different visual styles for mapped, unmapped, and missing cross-vault links
- **Hover previews**: Preview content from linked files on hover
- **Local copy backup**: Optionally create local copies of referenced files for offline access
- **Easy vault mapping**: Map vault names to their file system locations through settings or context menu
- **Click-to-map**: Right-click on unmapped `obsidian://` links to quickly set up vault mappings

## Installation

### Manual Installation

1. Download the latest release from the releases page
2. Extract the files to your vault's `.obsidian/plugins/obsidian-cross-vault/` directory
3. Enable the plugin in Obsidian's Community Plugins settings

### From Source

1. Clone this repository into your vault's `.obsidian/plugins/` directory
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Enable the plugin in Obsidian's Community Plugins settings

## Usage

### Setting up vault mappings

1. Go to Settings → Community Plugins → Cross Vault Linker
2. Click "Add mapping" to create a new vault mapping
3. Enter the vault name as it appears in `obsidian://` URLs
4. Enter the path to the vault (absolute or relative to current vault)
5. Optionally enable local copy for offline access

### Using cross-vault links

1. Paste an `obsidian://` URL in your note (e.g., `obsidian://open?vault=MyVault&file=MyFile`)
2. The link will show different visual indicators:
   - 🔗 **Green dotted underline**: Mapped and file found
   - ⚠️ **Orange dashed underline**: Vault not mapped (click to map)
   - ❌ **Red strikethrough**: File not found

### Quick vault mapping

1. Select an `obsidian://` URL in your editor
2. Right-click and choose "Map vault"
3. Enter the vault path in the dialog

### Local copy feature

When enabled for a vault:
- Files are automatically copied to a local folder named after the source vault
- If the original file becomes unavailable, the local copy is used instead
- Local copies are created in `YourVault/VaultName/filename.md`

## Configuration

The plugin stores its settings in `data.json` with the following structure:

```json
{
  "vaultMappings": {
    "VaultName": "/path/to/vault"
  },
  "enableLocalCopy": {
    "VaultName": true
  }
}
```

## Commands

- **Open cross-vault file**: Open the command palette and search for "Open cross-vault file" to manually open files from mapped vaults

## Supported URL Format

The plugin supports standard Obsidian URLs:
```
obsidian://open?vault=VaultName&file=FileName
```

Where:
- `VaultName` is the name of the target vault
- `FileName` is the name of the file (without .md extension)

## Limitations

- Desktop only (file system access required)
- Requires manual vault mapping setup
- Cross-vault files open in read-only mode within the current vault context

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

If you encounter issues or have feature requests, please create an issue on the GitHub repository. 