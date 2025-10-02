# Optimizely MCP Server

A Model Context Protocol (MCP) server for Optimizely CMS, providing AI assistants with comprehensive access to Optimizely's GraphQL API and Content Management API.

## Features

### Current (Phase 1)
- **Discovery-First Architecture**: Zero hardcoded assumptions about content types or fields
- **Dynamic Schema Introspection**: Discovers available content types and fields at runtime
- **Intelligent Field Mapping**: Pattern-based field matching with confidence scoring
- **Content Type Analysis**: Deep analysis of content requirements and constraints
- **GraphQL Integration**: Direct GraphQL queries with schema introspection
- **API Health Monitoring**: Test connectivity to both Graph and Content APIs
- **Smart Type Matching**: Fuzzy matching of requested types to available types
- **Caching**: Built-in caching for improved discovery performance
- **Type Safety**: Full TypeScript support with runtime validation

### Planned (Future Phases)
- **Full CRUD Operations**: Complete content lifecycle management
- **Version Management**: Create, publish, and manage content versions
- **Workflow Support**: Manage content approval workflows
- **Multi-language Support**: Handle content in multiple languages
- **Batch Operations**: Bulk content management capabilities
- **Advanced Search**: Natural language content queries

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
CMA_IMPERSONATE_USER=  # Optional: User email to impersonate (see Impersonation section)

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
        "CMA_TOKEN_ENDPOINT": "https://api.cms.optimizely.com/oauth/token",
        "CMA_IMPERSONATE_USER": ""
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

## Available Tools (13 Total - Phase 1)

> **Note**: This is Phase 1 of a major restructuring project. The full vision includes ~40 tools, but we're currently operating with a focused set of 13 essential tools while migrating to a discovery-first architecture.

### Utility Tools (3)
- `health-check` - Check API connectivity and server health
- `get-config` - Get current server configuration (sanitized)
- `get-documentation` - Get documentation for available tools

### Graph Tools (2)
- `graph-query` - Execute custom GraphQL queries (for complex queries during migration)
- `graph-introspection` - Get the GraphQL schema for discovery and validation

### Content Tools (4)
- `content-test-api` - Test Content Management API connectivity and available endpoints
- `type-discover` - Discover content types with smart matching
- `type-match` - Smart match a requested content type to available types
- `content_type_analyzer` - Analyze content type requirements, fields, and generate examples

### Intelligent Tools (3)
- `content_creation_wizard` - Interactive wizard for content creation with discovery
- `graph_discover_types` - Discover all available content types dynamically from GraphQL schema
- `graph_discover_fields` - Discover all available fields for a specific content type

### Helper Tools (1)
- `get-full-content-by-path` - Retrieve complete content data by URL path

## Key Architecture Principles (New in Phase 1)

### Discovery-First Design
Unlike traditional integrations that hardcode content types and field names, this MCP server:
- **Never hardcodes content types** - No assumptions about "ArticlePage", "StandardPage", etc.
- **Never hardcodes field mappings** - No predefined paths like "SeoSettings.MetaTitle"
- **Discovers everything dynamically** - Uses introspection to understand your CMS
- **Adapts to any CMS configuration** - Works with custom content types and fields

### Intelligent Field Mapping
The server uses pattern matching and similarity scoring to:
- Map user-friendly field names to actual CMS fields
- Handle nested properties automatically
- Generate appropriate default values based on field types
- Provide confidence scores for mappings

### Smart Content Creation Workflow
1. **Discover** available content types using `type-discover` or `graph_discover_types`
2. **Analyze** requirements with `content_type_analyzer` to understand fields
3. **Create** content using `content_creation_wizard` with intelligent field mapping
4. **Validate** against discovered schema constraints

## Migration Roadmap

This server is undergoing a major architectural transformation from 39 specialized tools to 10 powerful, discovery-first tools:

### Phase 1 (Current) - Foundation
- ✅ Removed all hardcoded content types and field names
- ✅ Implemented discovery tools for types and schemas
- ✅ Built intelligent field mapping engine
- 🔄 Operating with 13 essential tools during transition

### Phase 2 - Search & Retrieval
- 🔲 Implement unified `search` tool replacing multiple graph tools
- 🔲 Add `locate` tool for finding content by ID/path
- 🔲 Build `retrieve` tool for full content data

### Phase 3 - Content Management
- 🔲 Implement `create` tool with full field mapping
- 🔲 Add `update` tool with intelligent patching
- 🔲 Build `manage` tool for lifecycle operations

### Phase 4 - Help & Polish
- 🔲 Add context-aware `help` tool
- 🔲 Remove compatibility layers
- 🔲 Achieve target of 10 core tools

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

4. **403 Forbidden Errors (Content Creation)**
   - This typically means insufficient permissions
   - See the Impersonation section below for a solution
   - Verify the user has content creation rights
   - Check the target container allows the content type

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

## User Impersonation

If you encounter 403 Forbidden errors when creating content, you can use **user impersonation** to execute API calls as a specific user who has the necessary permissions.

### When to Use Impersonation

Use impersonation when:
- The API client lacks content creation permissions
- You need to test with different user permission levels
- You want actions attributed to a specific user

### Setup Instructions

1. **Enable Impersonation in Optimizely CMS**:
   - Log into Optimizely CMS as an administrator
   - Navigate to **Settings > API Clients**
   - Find your API client
   - Enable the **"Allow impersonation"** option
   - Save the changes

2. **Configure the MCP Server**:
   ```env
   # In your .env file
   CMA_IMPERSONATE_USER=user@example.com
   ```

3. **Update Claude Desktop Config** (if using environment variables):
   ```json
   {
     "mcpServers": {
       "optimizely": {
         "env": {
           "CMA_IMPERSONATE_USER": "user@example.com",
           // ... other settings
         }
       }
     }
   }
   ```

### How It Works

When impersonation is configured:
- Authentication requests use JSON format with `act_as` field
- All content operations execute as the impersonated user
- Created content shows the impersonated user as the author

### Testing Impersonation

Test that impersonation is working:

```bash
# Run the impersonation test script
node scripts/test-impersonation-final.js
```

This will create test content and show which user created it.

### Security Best Practices

- Only enable impersonation when necessary
- Use accounts with minimal required permissions
- Regularly review API client permissions
- Monitor API usage logs for unusual activity

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run `npm test` and `npm run typecheck`
6. Submit a pull request

## License

MIT
