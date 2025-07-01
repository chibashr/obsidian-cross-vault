# Cross Vault Navigator

An Obsidian plugin that enables seamless navigation and linking between different Obsidian vaults stored locally or in relative paths.

## Features

- **Cross-Vault Linking**: Parse and handle `obsidian://` URLs to link to notes in other vaults
- **Vault Mapping**: Configure local paths for external vaults in the plugin settings
- **Preview Support**: Hover over cross-vault links to preview content from external vaults
- **Local Caching**: Optional feature to cache referenced files locally for offline access
- **Context Menu Integration**: Right-click on `obsidian://` links to quickly map unknown vaults
- **Status Indicators**: Visual indicators showing the status of cross-vault links

## Installation

### Manual Installation

1. Download the latest release from the GitHub repository
2. Extract the files to your vault's `.obsidian/plugins/obsidian-cross-vault/` directory
3. Enable the plugin in Obsidian's Community Plugins settings

### Development Installation

1. Clone this repository into your vault's `.obsidian/plugins/` directory
2. Navigate to the plugin directory and run:
   ```bash
   npm install
   npm run build
   ```
3. Enable the plugin in Obsidian

## Usage

### Setting Up Vault Mappings

1. Open Obsidian Settings
2. Navigate to "Cross Vault Navigator" in the Plugin Options
3. Click "Add Vault" to create a new vault mapping
4. Enter the vault name and local path
5. Optionally enable "Local Cache" for offline access

### Using Cross-Vault Links

Once vault mappings are configured, paste any `obsidian://` link into your notes:

```
obsidian://open?vault=ExampleVault&file=Example%20Note
```

The plugin will:
- Display a status indicator (✓ for success, ? for unmapped vault, ✗ for errors)
- Provide hover previews of the linked content
- Allow clicking to open the referenced file

### Quick Vault Mapping

1. Select an `obsidian://` link in your editor
2. Right-click to open the context menu
3. Select "Map Vault" to quickly configure the vault path

## Configuration

### Vault Mapping Settings

- **Vault Name**: The name of the external vault as it appears in `obsidian://` URLs
- **Vault Path**: The local file system path to the vault directory
- **Enable Local Cache**: When enabled, referenced files are cached locally

### Commands

- **Refresh Cross-Vault Links**: Refreshes all cross-vault links in the current note

## Development

### Building the Plugin

```bash
npm install
npm run build
```

### Development Mode

```bash
npm run dev
```

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

## License

MIT License

## Author

chibashr

## Support

For support and bug reports, please use the GitHub issues page. 