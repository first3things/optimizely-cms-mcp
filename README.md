# Optimizely MCP Server

A Model Context Protocol (MCP) server for Optimizely CMS, providing AI assistants with comprehensive access to Optimizely's GraphQL API and Content Management API.

## Features

- **GraphQL Integration**: Query content using Optimizely Graph API
- **Content Management**: Full CRUD operations via Content Management API
- **Asset Management**: Upload and manage media assets
- **Multi-language Support**: Handle content in multiple languages
- **Caching**: Built-in caching for improved performance
- **Type Safety**: Full TypeScript support

## Installation

```bash
npm install optimizely-mcp-server
```

## Configuration

Create a `.env` file based on `.env.example`:

```env
# Optimizely Graph Configuration
GRAPH_ENDPOINT=https://cg.optimizely.com/content/v2/graphql
GRAPH_SINGLE_KEY=your-single-key
GRAPH_AUTH_METHOD=single_key

# Content Management API Configuration
CMA_BASE_URL=https://example.com/api/episerver/v3.0
CMA_CLIENT_ID=your-client-id
CMA_CLIENT_SECRET=your-client-secret
```

## Usage

### As an MCP Server

Add to your MCP client configuration:

```json
{
  "optimizely": {
    "command": "npx",
    "args": ["optimizely-mcp-server"],
    "env": {
      "GRAPH_ENDPOINT": "https://cg.optimizely.com/content/v2/graphql",
      "GRAPH_SINGLE_KEY": "your-key"
    }
  }
}
```

### Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## Available Tools

### Utility Tools
- `health-check`: Check server health and API connectivity
- `get-config`: Get current configuration (sanitized)
- `get-documentation`: Get tool documentation

### Graph Tools (Coming Soon)
- `graph-query`: Execute GraphQL queries
- `graph-search`: Full-text search
- `graph-get-content`: Get content by ID

### Content Tools (Coming Soon)
- `content-create`: Create new content
- `content-update`: Update existing content
- `content-delete`: Delete content

## License

MIT