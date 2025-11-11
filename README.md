# Things 3 MCP Server

A local MCP (Model Context Protocol) server for Things 3 on macOS that enables AI assistants to read and manage your tasks, projects, and areas directly through Things' AppleScript interface and URL scheme.

## Features

The server exposes the following tools for AI interaction:

### Reading Data (via AppleScript)
- **things_list_areas** - List all Things areas with their IDs and names
- **things_list_projects** - List projects, optionally filtered by area
- **things_list_todos** - List to-dos from built-in lists (Inbox, Today, Upcoming, Anytime, Someday) or from specific projects

### Creating Items
- **things_create_todo** - Create new to-dos with full parameter support (notes, when, deadline, tags, project/area assignment)
- **things_create_project** - Create new projects via Things URL scheme

### Managing Items
- **things_update_item** - Update to-dos or projects by ID (requires auth token)
- **things_complete** - Mark a to-do as completed
- **things_cancel** - Mark a to-do as canceled

### Navigation
- **things_show** - Open Things to a specific item or view
- **things_search** - Run a search query in the Things UI

## Prerequisites

1. **macOS** with **Things 3** installed
2. **Node.js 20+** (or 18+ should work)
3. **Enable Things URL scheme** in Things → Settings → General → "Enable Things URLs" → **Manage**
   - Get your auth token from this screen (required for update operations)
4. Xcode Command Line Tools (for `osascript` which is called under the hood)

## Installation

```bash
# Clone the repository
git clone https://github.com/SeanMatthewAI/things3-mcp.git
cd things3-mcp

# Install dependencies
npm install

# Build the TypeScript
npm run build
```

## Configuration

### For Claude Desktop

Add to your Claude Desktop settings.json (found at `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "things": {
      "command": "node",
      "args": ["/absolute/path/to/things3-mcp/dist/index.js"],
      "env": {
        "THINGS_AUTH_TOKEN": "YOUR_THINGS_AUTH_TOKEN"
      }
    }
  }
}
```

Or if you want to run with TypeScript directly (during development):

```json
{
  "mcpServers": {
    "things": {
      "command": "npx",
      "args": ["ts-node", "/absolute/path/to/things3-mcp/src/index.ts"],
      "env": {
        "THINGS_AUTH_TOKEN": "YOUR_THINGS_AUTH_TOKEN"
      }
    }
  }
}
```

### For Other MCP Clients

The server runs over stdio and expects the `THINGS_AUTH_TOKEN` environment variable to be set for update operations.

## Usage Examples

Once configured, your AI assistant can interact with Things using natural language. Here are some example commands:

### List today's tasks
```
"Show me what's on my Today list in Things"
```

### Create a new task
```
"Add a task 'Pack kids' lunches' for tonight with the Home tag"
```

### Create a project
```
"Create a new project called 'Zurich January Trip' and show it to me"
```

### Update a task
```
"Update task [ID] to have a deadline of next Friday"
```

### Complete tasks
```
"Mark task [ID] as completed"
```

## Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Run built version
npm start
```

## How It Works

The server uses two approaches to interact with Things:

1. **AppleScript** for reading data - Provides direct access to Things' object model including lists, projects, areas, and to-dos with all their properties
2. **Things URL Scheme** for write operations - Uses the official URL scheme API for creating and updating items, ensuring compatibility and supporting features like auth tokens

## Security

- Runs fully local - no cloud services or external APIs
- Auth token is stored in environment variables, not in code
- Only accesses Things 3 application data through official interfaces

## API Reference

### Authentication

The `THINGS_AUTH_TOKEN` is required for update operations. You can:
1. Set it in the MCP server environment configuration (recommended)
2. Pass it explicitly in the `authToken` field when calling `things.update_item`

### Date Formats

Date parameters (`when`, `deadline`) support:
- Special values: "today", "evening", "tomorrow"
- Natural language dates that macOS can parse
- ISO date strings

### Built-in Lists

The following built-in lists are supported:
- Inbox
- Today
- Anytime
- Upcoming
- Someday

## Troubleshooting

### "Things3 is not running"
Make sure Things 3 is open before using the MCP server.

### "Missing Things auth token"
1. Open Things → Settings → General
2. Enable "Things URLs"
3. Click "Manage" to get your auth token
4. Add it to your MCP client configuration

### AppleScript errors
Ensure you have granted necessary permissions for Terminal/your IDE to control Things via System Preferences → Security & Privacy → Privacy → Automation.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Links

- [Things URL Scheme Documentation](https://culturedcode.com/things/support/articles/2803573/)
- [Things AppleScript Guide](https://culturedcode.com/things/support/articles/2803572/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)