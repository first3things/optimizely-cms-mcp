# Optimizely MCP Server

A Model Context Protocol (MCP) server for Optimizely CMS, providing AI assistants with comprehensive access to Optimizely's GraphQL API and Content Management API.

## Features

- **GraphQL Integration**: Query content using Optimizely Graph API with multiple authentication methods
- **Content Management**: Full CRUD operations via Content Management API v3.0
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
GRAPH_ENDPOINT=https://cg.optimizely.com/content/v2/graphql
GRAPH_AUTH_METHOD=single_key # Options: single_key, hmac, basic, bearer, oidc
GRAPH_SINGLE_KEY=your-single-key
# For HMAC auth:
# GRAPH_APP_KEY=your-app-key
# GRAPH_SECRET_KEY=your-secret-key

# Content Management API Configuration
CMA_BASE_URL=https://example.com/api/episerver/v3.0
CMA_CLIENT_ID=your-client-id
CMA_CLIENT_SECRET=your-client-secret
CMA_GRANT_TYPE=client_credentials
CMA_SCOPE=epi_content_management

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
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test tests/unit/graph-client.test.ts

# Type checking
npm run typecheck

# Linting
npm run lint
```

## MCP Client Configuration

### Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "optimizely": {
      "command": "node",
      "args": ["/path/to/optimizely-mcp-server/dist/index.js"],
      "env": {
        "GRAPH_ENDPOINT": "https://cg.optimizely.com/content/v2/graphql",
        "GRAPH_AUTH_METHOD": "single_key",
        "GRAPH_SINGLE_KEY": "your-key",
        "CMA_BASE_URL": "https://example.com/api/episerver/v3.0",
        "CMA_CLIENT_ID": "your-client-id",
        "CMA_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

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

## Available Tools

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

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify your API credentials in `.env`
   - Check token expiration for CMA
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