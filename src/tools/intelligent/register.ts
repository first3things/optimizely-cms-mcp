/**
 * Intelligent Tools
 * 
 * Temporary reduced set during migration to new 10-tool architecture
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../../types/tools.js';
import { getGraphConfig, getCMAConfig } from '../../config.js';
import {
  executeContentWizard
} from '../../logic/content/intelligent-create.js';
import {
  executeGetContentTypes,
  executeGetFieldsForType
} from '../../logic/graph/intelligent-tools.js';

export function getIntelligentTools(): Tool[] {
  return [
    // Keep only essential discovery tools during migration
    {
      name: 'content_creation_wizard',
      description: 'Interactive wizard for content creation with discovery',
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
            description: 'Content properties',
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
    }
  ];
}

export function registerIntelligentHandlers(
  handlers: Map<string, (params: any, context: ToolContext) => Promise<any>>
): void {
  const graphConfig = (context: ToolContext) => getGraphConfig(context.config);
  const cmaConfig = (context: ToolContext) => getCMAConfig(context.config);

  handlers.set('content_creation_wizard', async (params, context) => 
    executeContentWizard(graphConfig(context), cmaConfig(context), params)
  );
  
  handlers.set('graph_discover_types', async (_params, context) => 
    executeGetContentTypes(graphConfig(context))
  );
  
  handlers.set('graph_discover_fields', async (params, context) => 
    executeGetFieldsForType(graphConfig(context), params)
  );
}