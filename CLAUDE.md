# Optimizely CMS MCP Server Guide

## 🚀 START HERE - Quick Reference for Claude

When searching for content in Optimizely CMS, **ALWAYS** follow this workflow:

```bash
# Step 1: Get help (if needed)
help({})

# Step 2: Discover available content types
discover({"target": "types"})

# Step 3: Discover fields for the content type you want
discover({"target": "fields", "contentType": "ArticlePage"})

# Step 4: Search using discovered information
search({"query": "your search", "contentTypes": ["ArticlePage"]})
```

**Never use `graph-query` with guessed field names!** Always discover first.

## Overview

The Optimizely CMS MCP (Model Context Protocol) server is a **multi-tenant, discovery-first integration** designed to work with ANY Optimizely CMS instance without requiring hardcoded assumptions about content types, field names, or schema structures.

This server enables AI assistants like Claude to interact with Optimizely CMS through a standardized protocol, providing intelligent content management capabilities while adapting dynamically to each unique CMS configuration.

## Core Principles

### 1. Zero Hardcoding Policy
- **No hardcoded content types**: No assumptions about "ArticlePage", "StandardPage", etc.
- **No hardcoded field mappings**: No predefined paths like "SeoSettings.MetaTitle"
- **No hardcoded examples**: All examples use placeholders that work universally
- **Dynamic discovery**: Every operation starts by discovering what's actually available

### 2. Discovery-First Architecture
Every interaction follows this pattern:
1. **Discover** what's available in the CMS
2. **Analyze** the discovered schema to understand requirements
3. **Execute** operations using the discovered information
4. **Validate** results against the discovered constraints

### 3. Multi-Tenant Design
- Works with any Optimizely CMS instance
- Adapts to custom content types and fields
- Supports different localization strategies
- Handles various composition patterns

## Optimizely API Integration

This MCP server integrates with two primary Optimizely APIs:

### 1. Content Management API (CMA)
**Base URL**: `https://api.cms.optimizely.com/preview3`

The Content Management API provides full CRUD operations for content:
- **Content Operations**: Create, read, update, delete content items
- **Version Management**: Handle content versions and locales
- **Content Types**: Discover and manage content type schemas
- **Property Formats**: Define reusable property configurations
- **Display Templates**: Manage content presentation options

**Key Endpoints**:
- `/contenttypes` - List and manage content types
- `/experimental/content` - Content CRUD operations
- `/experimental/content/{key}/versions` - Version management
- `/propertyformats` - Property format definitions

**Authentication**: OAuth2 client credentials flow
- Token endpoint: `https://api.cms.optimizely.com/oauth/token`
- Required scope: `api:admin`

### 2. Content Graph API
**Dynamic Endpoint**: Discovered from CMS instance

The Graph API provides fast, cached content retrieval:
- **GraphQL Interface**: Flexible querying with introspection
- **Optimized Search**: Full-text search and filtering
- **Cached Results**: Fast content retrieval
- **Hierarchical Data**: URL and navigation structures

**Key Capabilities**:
- Content search with relevance scoring
- Metadata retrieval without full content
- Batch operations for performance
- Type-safe GraphQL queries

## Tool Architecture (10 Core Tools)

### Discovery Tools
1. **`discover`** - Universal discovery for types, fields, and schemas
2. **`analyze`** - Deep analysis of content requirements

### Search Tools
3. **`search`** - Find content using Graph API
4. **`locate`** - Get content by ID or path

### Content Management Tools
5. **`retrieve`** - Get full content from CMA
6. **`create`** - Create content with intelligent mapping
7. **`update`** - Update existing content
8. **`manage`** - Lifecycle operations (delete, copy, move)

### System Tools
9. **`health`** - Check API connectivity and status
10. **`help`** - Context-aware guidance

## Intelligent Features

### Field Mapping Engine
- **No hardcoded mappings**: Discovers field names dynamically
- **Similarity scoring**: Matches user input to actual fields
- **Learning capability**: Improves mappings over time
- **Confidence ratings**: Indicates mapping reliability

### Validation Engine
- **Schema-based validation**: Uses discovered constraints
- **Required field checking**: Ensures completeness
- **Type validation**: Matches data to field types
- **Helpful error messages**: Guides users to fixes

### Smart Defaults
- **Context-aware generation**: Based on content type
- **No hardcoded values**: Generated from schema
- **Locale handling**: Respects localization settings
- **SEO optimization**: Generates appropriate metadata

## Implementation Architecture

```
┌─────────────────────────────────────────────────┐
│                   MCP Client                    │
│              (Claude, AI Assistant)             │
└─────────────────────┬───────────────────────────┘
                      │ MCP Protocol
┌─────────────────────┴───────────────────────────┐
│              MCP Server Core                     │
│  ┌─────────────────────────────────────────┐   │
│  │          Discovery Engine                │   │
│  │  - Content Type Discovery               │   │
│  │  - Field Schema Analysis                │   │
│  │  - Constraint Detection                 │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │         Intelligence Layer               │   │
│  │  - Field Mapping Engine                 │   │
│  │  - Validation Engine                    │   │
│  │  - Default Generator                    │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │           Tool Layer                     │   │
│  │  10 Core Tools (discover → manage)      │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────┘
                      │
       ┌──────────────┴──────────────┐
       │                             │
┌──────┴─────────┐        ┌──────────┴──────────┐
│   Graph API    │        │   Content API       │
│  (Search/Read) │        │  (Full CRUD Ops)    │
└────────────────┘        └─────────────────────┘
```

## Caching Strategy

### Schema Cache
- **Content Types**: 5-minute TTL
- **Field Definitions**: 10-minute TTL
- **Invalidation**: Manual or on schema changes
- **Memory Management**: LRU eviction policy

### Discovery Cache
- **Progressive Enhancement**: Cache builds over time
- **Selective Invalidation**: Only affected types
- **Performance**: Sub-second discovery after cache

## Error Handling

### Consistent Error Format
```json
{
  "error": "Human-readable message",
  "code": "STANDARDIZED_CODE",
  "tool": "tool_name",
  "suggestion": "How to fix the issue"
}
```

### Error Categories
- **DISCOVERY_ERROR**: Schema discovery failures
- **VALIDATION_ERROR**: Input validation issues
- **NOT_FOUND**: Content or type not found
- **API_ERROR**: External API failures
- **AUTH_ERROR**: Authentication issues

## 🚀 Quick Start Workflow

### The Discovery-First Approach

**IMPORTANT**: Always start with the `help` tool to learn the workflow!

```bash
# 1. Get oriented
help({})                     # General help
help({"topic": "workflow"})  # Learn the discovery-first workflow

# 2. Discover what's available
discover({"target": "types"})                          # Find all content types
discover({"target": "fields", "contentType": "ArticlePage"})  # Get fields for a type

# 3. Search for content
search({"query": "mcp server", "contentTypes": ["ArticlePage"]})

# 4. Get specific content
locate({"identifier": "/news/article-1"})              # Find by path
retrieve({"identifier": "12345"})                      # Get full content
```

### Common Mistakes to Avoid

❌ **DON'T** use `graph-query` directly with assumed field names  
✅ **DO** use `discover` first, then `search` with discovered fields

❌ **DON'T** assume fields like "Name", "Title", "Description" exist  
✅ **DO** discover actual field names (might be "Heading", "SubHeading", etc.)

❌ **DON'T** skip discovery when you get field errors  
✅ **DO** run `discover({"target": "fields", "contentType": "YourType"})` to see what's available

## Best Practices

### For AI Assistants (Claude)
1. **Start with help**: Run `help({})` to understand the workflow
2. **Always discover first**: Use `discover` before any content operations
3. **Use new tools**: Prefer `search` over `graph-query`, `locate` over `graph-get-by-id`
4. **Read error suggestions**: They guide you to the correct workflow
5. **Check field names**: When you get field errors, discover the actual fields

### For Developers
1. **Follow the pattern**: Help → Discover → Search/Locate → Retrieve
2. **Cache appropriately**: Use `useCache: true` for repeated discoveries
3. **Handle errors gracefully**: Check the suggestions in error messages
4. **Learn from discovery**: Save discovered schemas for reference

## API Documentation References

### Official Optimizely Documentation
- **Content Management API**: [Optimizely CMS Content API Documentation](https://docs.developers.optimizely.com/content-management-system/v1.5.0-preview/docs)
- **Content Graph**: [Optimizely Graph Documentation](https://docs.developers.optimizely.com/content-graph/docs)
- **Authentication**: [API Authentication Guide](https://docs.developers.optimizely.com/content-management-system/v1.5.0-preview/docs/authentication)

### Key Concepts
- **Content Types**: Define the structure of content
- **Properties**: Fields within content types
- **Localization**: Multi-language content support
- **Versioning**: Content version management
- **Composition**: Visual page building capabilities

## Migration from Legacy Tools

### Old Approach (39 tools)
```
graph-search → graph-by-id → content-get → content-create
(with hardcoded assumptions)
```

### New Approach (10 tools)
```
discover → search → retrieve → create
(with dynamic discovery)
```

### Benefits
- **Reduced complexity**: 75% fewer tools
- **Better accuracy**: No incorrect assumptions
- **Universal compatibility**: Works with any CMS
- **Improved UX**: Clearer tool purposes

## Future Enhancements

### Planned Features
1. **ML-powered field mapping**: Learn from usage patterns
2. **Batch operations**: Bulk content management
3. **Workflow integration**: Approval processes
4. **Advanced search**: Natural language queries
5. **Performance analytics**: Usage insights

### Extension Points
- Custom field validators
- Domain-specific mappings
- Industry-standard schemas
- Integration with other systems

## Summary

The Optimizely CMS MCP server represents a paradigm shift from hardcoded, assumption-based integrations to a truly dynamic, discovery-first approach. By eliminating all hardcoded values and building intelligence through discovery, this server can adapt to any Optimizely CMS configuration while providing a consistent, intuitive interface for AI assistants and developers alike.