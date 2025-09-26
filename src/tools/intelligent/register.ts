import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../../types/tools.js';
import { getGraphConfig, getCMAConfig } from '../../config.js';
import {
  executeFindContentByName,
  executeGetContentWithDetails,
  executeContentWizard
} from '../../logic/content/intelligent-create.js';
import {
  executeGetContentTypes,
  executeGetFieldsForType,
  executeIntelligentQuery
} from '../../logic/graph/intelligent-tools.js';

export function getIntelligentTools(): Tool[] {
  return [
    {
      name: 'content_find_by_name',
      description: 'Find content by name to get IDs and GUIDs. Perfect for locating "Home", "News", etc.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Content name to search for (e.g., "Home", "About Us")'
          },
          contentType: {
            type: 'string',
            description: 'Filter by content type (optional)'
          },
          limit: {
            type: 'integer',
            description: 'Maximum results to return',
            default: 10
          }
        },
        required: ['name'],
        additionalProperties: false
      }
    },
    {
      name: 'content_get_details',
      description: 'Get full details including GUID for a specific content ID',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID to get details for'
          }
        },
        required: ['contentId'],
        additionalProperties: false
      }
    },
    {
      name: 'content_creation_wizard',
      description: 'RECOMMENDED: Interactive wizard for content creation. Intelligently discovers your content types and their fields. Handles parent resolution, validation, and smart field population based on your CMS schema. Start with step="find-parent".',
      inputSchema: {
        type: 'object',
        properties: {
          step: {
            type: 'string',
            description: 'Wizard step',
            enum: ['start', 'find-parent', 'preview-content', 'create-content']
          },
          parentName: {
            type: 'string',
            description: 'Parent page name (for find-parent step)'
          },
          parentGuid: {
            type: 'string',
            description: 'Parent GUID (for create-content step)'
          },
          contentType: {
            type: 'string',
            description: 'Content type from your CMS (for create-content step)'
          },
          name: {
            type: 'string',
            description: 'Content name (for create-content step)'
          },
          displayName: {
            type: 'string',
            description: 'Display name (for create-content step)'
          },
          properties: {
            type: 'object',
            description: 'Content properties. The wizard will help you understand required fields for your content type.',
            additionalProperties: true
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'graph_discover_types',
      description: 'Discover all available content types in the CMS dynamically from the GraphQL schema',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'graph_discover_fields',
      description: 'Discover all available fields for a specific content type',
      inputSchema: {
        type: 'object',
        properties: {
          typeName: {
            type: 'string',
            description: 'The content type name to get fields for'
          }
        },
        required: ['typeName'],
        additionalProperties: false
      }
    },
    {
      name: 'graph_intelligent_query',
      description: 'Execute intelligent GraphQL queries that automatically discover and use available fields. No hardcoded field names!',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['search', 'getContent', 'getByPath', 'facetedSearch', 'related'],
            description: 'The operation to perform'
          },
          searchTerm: {
            type: 'string',
            description: 'Search term (required for search operation)'
          },
          contentId: {
            type: 'string',
            description: 'Content ID (required for getContent and related operations)'
          },
          path: {
            type: 'string',
            description: 'Content path (required for getByPath operation)'
          },
          contentTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by content types'
          },
          locale: {
            type: 'string',
            description: 'Language/locale'
          },
          limit: {
            type: 'integer',
            description: 'Maximum results'
          },
          skip: {
            type: 'integer',
            description: 'Skip results for pagination'
          },
          includeAllFields: {
            type: 'boolean',
            description: 'Include all available fields in the response'
          },
          maxDepth: {
            type: 'integer',
            description: 'Maximum depth for nested fields',
            default: 1
          },
          direction: {
            type: 'string',
            enum: ['incoming', 'outgoing'],
            description: 'Direction for related content'
          },
          facets: {
            type: 'object',
            description: 'Facet configuration for faceted search',
            additionalProperties: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                limit: { type: 'integer' }
              },
              required: ['field']
            }
          },
          filters: {
            type: 'object',
            description: 'Filters to apply',
            additionalProperties: true
          }
        },
        required: ['operation'],
        additionalProperties: false
      }
    }
  ];
}

export function registerIntelligentHandlers(
  handlers: Map<string, (params: any, context: ToolContext) => Promise<any>>
): void {
  const graphConfig = (context: ToolContext) => getGraphConfig(context.config);
  const cmaConfig = (context: ToolContext) => getCMAConfig(context.config);
  
  handlers.set('content_find_by_name', async (params, context) => 
    executeFindContentByName(graphConfig(context), params)
  );
  
  handlers.set('content_get_details', async (params, context) => 
    executeGetContentWithDetails(graphConfig(context), params)
  );
  
  handlers.set('content_creation_wizard', async (params, context) => 
    executeContentWizard(graphConfig(context), cmaConfig(context), params)
  );
  
  handlers.set('graph_discover_types', async (_params, context) => 
    executeGetContentTypes(graphConfig(context))
  );
  
  handlers.set('graph_discover_fields', async (params, context) => 
    executeGetFieldsForType(graphConfig(context), params)
  );
  
  handlers.set('graph_intelligent_query', async (params, context) => 
    executeIntelligentQuery(graphConfig(context), params)
  );
}