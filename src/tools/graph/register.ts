/**
 * Optimizely Graph Tools
 * 
 * RECOMMENDED WORKFLOW:
 * 1. Use graph-search FIRST to find content (e.g., search "home" for homepage)
 * 2. Use graph-get-content or graph-get-content-by-path to get full details
 * 3. Only use graph-query for complex custom queries
 * 
 * For homepage: Use graph-get-content-by-path with path="/"
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../../types/tools.js';
import { getGraphConfig } from '../../config.js';
import {
  executeGraphQuery,
  executeGraphIntrospection,
  executeGraphGetContentByPath,
  executeGraphGetRelated
} from '../../logic/graph/query.js';
import {
  executeGraphSearch,
  executeGraphGetContent,
  executeGraphAutocomplete,
  executeGraphGetChildren,
  executeGraphGetAncestors,
  executeGraphFacetedSearch
} from '../../logic/graph/search.js';

export function getGraphTools(): Tool[] {
  return [
    {
      name: 'graph-query',
      description: 'Execute custom GraphQL queries. Use OTHER TOOLS FIRST (graph-search, graph-get-content) for common operations. Only use this for complex queries or when other tools don\'t meet your needs.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'GraphQL query string'
          },
          variables: {
            type: 'object',
            description: 'Query variables',
            additionalProperties: true
          },
          operationName: {
            type: 'string',
            description: 'Operation name for multi-operation documents'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: 'graph-introspection',
      description: 'Get the GraphQL schema for discovery and validation',
      inputSchema: {
        type: 'object',
        properties: {
          includeDeprecated: {
            type: 'boolean',
            description: 'Include deprecated fields in the schema'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'graph-search',
      description: 'Search for content in Optimizely Graph. USE THIS FIRST to find pages, articles, or any content before using other graph tools. Searches in displayName, heading, title, and metadata fields. Example: search for "home" to find homepage, "article" to find articles, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term'
          },
          types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Content types to search'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fields to search within'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20,
            description: 'Maximum results'
          },
          skip: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Pagination offset'
          },
          locale: {
            type: 'string',
            description: 'Language/locale filter'
          },
          orderBy: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
            },
            description: 'Sort configuration'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: 'graph-autocomplete',
      description: 'Get search suggestions and autocomplete',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Partial search term'
          },
          field: {
            type: 'string',
            description: 'Field to autocomplete'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            default: 10,
            description: 'Maximum suggestions'
          },
          locale: {
            type: 'string',
            description: 'Language/locale filter'
          }
        },
        required: ['query', 'field'],
        additionalProperties: false
      }
    },
    {
      name: 'graph-faceted-search',
      description: 'Execute faceted search with aggregations',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term (optional)'
          },
          facets: {
            type: 'object',
            description: 'Facet configuration (e.g., {"category": {"field": "_metadata.contentType", "limit": 10}})',
            additionalProperties: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                limit: { type: 'integer', minimum: 1, default: 10 }
              },
              required: ['field']
            }
          },
          filters: {
            type: 'object',
            description: 'Applied filters',
            additionalProperties: true
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20,
            description: 'Results per page'
          },
          skip: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Pagination offset'
          },
          locale: {
            type: 'string',
            description: 'Language/locale filter'
          }
        },
        required: ['facets'],
        additionalProperties: false
      }
    },
    {
      name: 'graph-get-content',
      description: 'Get full content details by ID/key. Use AFTER graph-search to get complete content. Note: If ID has suffixes like _en_Published, they will be handled automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Content ID, key, or GUID'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific fields to return'
          },
          locale: {
            type: 'string',
            description: 'Language version'
          },
          includeRelated: {
            type: 'boolean',
            description: 'Include related content'
          }
        },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'graph-get-content-by-path',
      description: 'Get content by its URL path (e.g., "/" for homepage, "/articles/my-article/"). Useful when you know the page URL.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'URL path (e.g., /en/products/my-product)'
          },
          locale: {
            type: 'string',
            description: 'Language version'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific fields to return'
          }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    {
      name: 'graph-get-children',
      description: 'Get child content items (Note: This may not work in Optimizely Graph - use graph-search with appropriate filters instead)',
      inputSchema: {
        type: 'object',
        properties: {
          parentId: {
            type: 'string',
            description: 'Parent content ID'
          },
          contentTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by content type'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: 'Maximum results'
          },
          skip: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Pagination offset'
          },
          orderBy: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
            },
            description: 'Sort configuration'
          }
        },
        required: ['parentId'],
        additionalProperties: false
      }
    },
    {
      name: 'graph-get-ancestors',
      description: 'Get ancestor hierarchy',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: 'string',
            description: 'Content ID'
          },
          levels: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            default: 10,
            description: 'Maximum levels to traverse'
          }
        },
        required: ['contentId'],
        additionalProperties: false
      }
    },
    {
      name: 'graph-get-related',
      description: 'Find related content through references',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: 'string',
            description: 'Source content ID'
          },
          relationshipType: {
            type: 'string',
            description: 'Type of relationship (optional)'
          },
          direction: {
            type: 'string',
            enum: ['incoming', 'outgoing'],
            default: 'outgoing',
            description: 'Reference direction'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20,
            description: 'Maximum results'
          }
        },
        required: ['contentId'],
        additionalProperties: false
      }
    }
  ];
}

export function registerGraphHandlers(
  handlers: Map<string, (params: any, context: ToolContext) => Promise<any>>
): void {
  handlers.set('graph-query', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphQuery(graphConfig, params);
  });

  handlers.set('graph-introspection', async (_params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphIntrospection(graphConfig);
  });

  handlers.set('graph-search', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphSearch(graphConfig, params);
  });

  handlers.set('graph-autocomplete', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphAutocomplete(graphConfig, params);
  });

  handlers.set('graph-faceted-search', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphFacetedSearch(graphConfig, params);
  });

  handlers.set('graph-get-content', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphGetContent(graphConfig, params);
  });

  handlers.set('graph-get-content-by-path', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphGetContentByPath(graphConfig, params);
  });

  handlers.set('graph-get-children', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphGetChildren(graphConfig, params);
  });

  handlers.set('graph-get-ancestors', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphGetAncestors(graphConfig, params);
  });

  handlers.set('graph-get-related', async (params, context) => {
    const graphConfig = getGraphConfig(context.config);
    return executeGraphGetRelated(graphConfig, params);
  });
}