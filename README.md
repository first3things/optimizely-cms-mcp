# Optimizely MCP Server

A Model Context Protocol (MCP) server for Optimizely CMS, providing AI assistants with comprehensive access to Optimizely's GraphQL API and Content Management API.

## Features

- **GraphQL Integration**: Query content using Optimizely Graph API with multiple authentication methods
- **Content Management**: Full CRUD operations via Content Management API (Preview3/Experimental)
- **Version Management**: Create, publish, and manage content versions
- **Content Types**: Explore and understand content type schemas
- **Workflow Support**: Manage content approval workflows
- **Multi-language Support**: Handle content in multiple languages
- **Caching**: Built-in caching for improved performance
- **Type Safety**: Full TypeScript support with runtime validation

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/optimizely-mcp-server.git
cd optimizely-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

Create a `.env` file in the project root:

```env
# Server Configuration
SERVER_NAME=optimizely-mcp-server
SERVER_VERSION=1.0.0
TRANSPORT=stdio

# Optimizely Graph Configuration
GRAPH_ENDPOINT=https://cg.optimizely.com/content/v2
GRAPH_AUTH_METHOD=single_key # Options: single_key, hmac, basic, bearer, oidc
GRAPH_SINGLE_KEY=your-single-key
# For HMAC auth:
# GRAPH_APP_KEY=your-app-key
# GRAPH_SECRET_KEY=your-secret-key

# Content Management API Configuration
CMA_BASE_URL=https://api.cms.optimizely.com/preview3
CMA_CLIENT_ID=your-client-id  # Get from Settings > API Keys in CMS
CMA_CLIENT_SECRET=your-client-secret
CMA_GRANT_TYPE=client_credentials
CMA_TOKEN_ENDPOINT=https://api.cms.optimizely.com/oauth/token

# Optional Configuration
CACHE_TTL=300000 # Cache TTL in milliseconds (default: 5 minutes)
LOG_LEVEL=info # Options: debug, info, warn, error
MAX_RETRIES=3
TIMEOUT=30000
```

## Running the Server

### Development Mode

```bash
# Run with hot reloading
npm run dev

# Run with debug logging
LOG_LEVEL=debug npm run dev
```

### Production Mode

```bash
# Build and run
npm run build
npm start

# Or run directly
node dist/index.js
```

### Testing the Server

```bash
# Run all unit tests
npm test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run typecheck

# Linting
npm run lint
```

## How MCP Servers Work

MCP servers communicate via **stdio** (standard input/output), not HTTP ports:

- **No port required** - The server doesn't listen on any network port
- **Process-based** - Claude Desktop spawns your server as a child process
- **JSON-RPC messages** - Communication happens through stdin/stdout pipes
- **Secure** - No network exposure, runs only when Claude needs it

## MCP Client Configuration

### Claude Desktop Setup

#### Step 1: Find your config file

Open the configuration file in a text editor:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

For Windows, you can open it quickly with:
```cmd
notepad %APPDATA%\Claude\claude_desktop_config.json
```

#### Step 2: Add the server configuration

```json
{
  "mcpServers": {
    "optimizely": {
      "command": "node",
      "args": ["%USERPROFILE%\\path\\to\\optimizely-mcp-server\\dist\\index.js"],
      "env": {
        "LOG_LEVEL": "error",
        "GRAPH_ENDPOINT": "https://cg.optimizely.com/content/v2",
        "GRAPH_AUTH_METHOD": "single_key",
        "GRAPH_SINGLE_KEY": "your-key",
        "CMA_BASE_URL": "https://api.cms.optimizely.com/preview3/experimental",
        "CMA_CLIENT_ID": "your-client-id",
        "CMA_CLIENT_SECRET": "your-client-secret",
        "CMA_GRANT_TYPE": "client_credentials",
        "CMA_TOKEN_ENDPOINT": "https://api.cms.optimizely.com/oauth/token"
      }
    }
  }
}
```
In JSON on Windows, you must use double backslashes (\\). If your folder path has spaces, this still works because each argument is a separate JSON string.

- Windows: %USERPROFILE% expands to your home directory (e.g., C:\Users\Alice). If Claude doesn’t expand it automatically, replace it with your actual path (e.g., C:\\Users\\Alice\\path\\to\\optimizely-mcp-server\\dist\\index.js). In PowerShell, the equivalent is $env:USERPROFILE, but inside this JSON config you should keep %USERPROFILE% or use the full path.
- macOS/Linux: the equivalent shortcut is ~ or $HOME (e.g., /Users/alice or /home/alice). If ~/$HOME isn’t expanded correctly, replace it with the full path.

#### Step 3: Restart Claude Desktop

After saving the config file:
1. Completely quit Claude Desktop (not just close the window)
2. Start Claude Desktop again
3. The Optimizely tools should now be available

#### Step 4: Verify it's working

In a new Claude conversation, try:
- "Can you list the available Optimizely tools?"
- "Use the health-check tool to test the connection"

### Troubleshooting

If the server doesn't load:
1. Check the file path is correct and uses proper escaping (`\\` for Windows)
2. Ensure you've built the project (`npm run build`)
3. Verify the `dist/index.js` file exists
4. Check Claude's logs for errors

### Other MCP Clients

For other MCP-compatible clients, use the stdio transport configuration:

```json
{
  "name": "optimizely",
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["/path/to/optimizely-mcp-server/dist/index.js"]
  },
  "env": {
    // Environment variables as above
  }
}
```

## Available Tools (38 Total)

### Utility Tools (3)
- `test_connection` - Test connectivity to Optimizely APIs
- `health_check` - Check server health status
- `get_config` - Get current configuration (sanitized)

### GraphQL Query Tools (10)
- `graph_search` - Full-text content search
- `graph_autocomplete` - Get autocomplete suggestions
- `graph_facet_search` - Search with faceted filtering
- `graph_get_by_id` - Get content by numeric ID
- `graph_get_by_guid` - Get content by GUID
- `graph_get_children` - Get child content items
- `graph_get_ancestors` - Get ancestor hierarchy
- `graph_get_descendants` - Get all descendants
- `graph_get_by_route` - Get content by route segment
- `graph_get_by_url` - Get content by full URL

### Content Management Tools (17)

#### Content CRUD (7)
- `content_create` - Create new content
- `content_get` - Get content by ID
- `content_update` - Update existing content
- `content_patch` - Apply JSON Patch operations
- `content_delete` - Delete content
- `content_move` - Move content to new location
- `content_copy` - Copy content

#### Version Management (5)
- `version_list` - List all content versions
- `version_get` - Get specific version
- `version_create` - Create new version
- `version_publish` - Publish a version
- `version_set_common_draft` - Set as common draft

#### Content Types (3)
- `type_list` - List available content types
- `type_get` - Get content type details
- `type_get_schema` - Get JSON schema for type

#### Workflows (2)
- `workflow_get` - Get workflow status
- `workflow_transition` - Change workflow state

### Intelligent Content Tools (4)
These tools combine GraphQL and CMA to provide smart content creation:

- `content_find_by_name` - Find content by name (e.g., "Home", "News") to get IDs and GUIDs
- `content_get_details` - Get full details including GUID for a specific content
- `content_create_under` - Create content under a parent by name (e.g., "create under Home")
- `content_creation_wizard` - Interactive wizard for guided content creation

#### Example: Creating content under "Home"
Instead of needing to know the Home page's GUID, you can now:
1. Use `content_find_by_name` with "Home" to find the page
2. Use `content_create_under` to create content directly under it
3. Or use `content_creation_wizard` for a step-by-step process

## Development

### Project Structure

```
optimizely-mcp-server/
├── src/
│   ├── index.ts          # Server entry point
│   ├── register.ts       # Tool registration
│   ├── config.ts         # Configuration management
│   ├── clients/          # API clients
│   │   ├── graph-client.ts
│   │   └── cma-client.ts
│   ├── logic/            # Tool implementations
│   │   ├── utility/
│   │   ├── graph/
│   │   └── content/
│   ├── types/            # TypeScript types
│   └── utils/            # Utilities
├── tests/                # Test files
├── dist/                 # Built output
└── package.json
```

### Adding New Tools

1. Create tool implementation in `src/logic/`
2. Add tool registration in appropriate section
3. Add TypeScript types if needed
4. Write tests in `tests/`
5. Update documentation

### Testing Guidelines

- Unit tests for all tool implementations
- Integration tests for API clients
- Mock external API calls
- Test error scenarios
- Maintain >80% coverage

## Testing & Debugging

### Unit Tests

Run automated tests with Vitest:

```bash
# Run unit tests
npm test

# Run with coverage report
npm run test:coverage
```

Unit tests are located in `/tests/` and cover:
- GraphQL client functionality
- CMA client operations
- Health check features

### Integration Testing & Debugging

Test your setup with these npm scripts:

```bash
# Check credentials are valid
npm run check:credentials

# Test MCP tools
npm run test:tools

# Test with debug output
npm run test:tools:debug

# Test GraphQL connection
npm run debug:graph

# Validate API key format
npm run validate:key
```

### Debugging Scripts

The `scripts/` directory contains utilities for testing and debugging:

- **`quick-test.js`** - Test MCP server tools through stdio
- **`test-with-debug.js`** - Detailed API request/response logging
- **`debug-graph.js`** - Direct GraphQL endpoint testing
- **`debug-auth-comprehensive.js`** - Test all authentication methods
- **`validate-key.js`** - Validate GraphQL key format
- **`find-graphql-endpoint.js`** - Discover your GraphQL endpoint

For PowerShell users, set environment variables like this:
```powershell
$env:LOG_LEVEL="debug"; npm run test:tools:debug
```

See [scripts/TESTING_SCRIPTS.md](scripts/TESTING_SCRIPTS.md) for detailed documentation.

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify your API credentials in `.env`
   - For CMA: Create API keys in Settings > API Keys in your Optimizely CMS instance
   - Check token expiration for CMA (tokens expire after 5 minutes)
   - Ensure correct auth method for Graph

2. **Connection Issues**
   - Verify network connectivity
   - Check firewall settings
   - Confirm API endpoints are accessible

3. **Build Errors**
   - Run `npm install` to ensure dependencies
   - Check Node.js version (>=18 required)
   - Clear `dist/` and rebuild

### Debug Mode

Enable debug logging for troubleshooting:

```bash
LOG_LEVEL=debug npm start
```

### Health Check

Test server connectivity:

```bash
# Using the built tool
echo '{"method": "tools/call", "params": {"name": "health_check"}}' | node dist/index.js
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run `npm test` and `npm run typecheck`
6. Submit a pull request

## License

MIT
