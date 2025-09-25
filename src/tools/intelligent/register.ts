import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../../types/tools.js';
import { getGraphConfig, getCMAConfig } from '../../config.js';
import {
  executeFindContentByName,
  executeGetContentWithDetails,
  executeIntelligentCreate,
  executeContentWizard
} from '../../logic/content/intelligent-create.js';

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
      name: 'content_create_under',
      description: 'Intelligently create content under a parent by name (e.g., "create under Home")',
      inputSchema: {
        type: 'object',
        properties: {
          parentName: {
            type: 'string',
            description: 'Name of parent content (e.g., "Home", "News Section")'
          },
          contentType: {
            type: 'string',
            description: 'Content type to create (e.g., "StandardPage", "ArticlePage")'
          },
          name: {
            type: 'string',
            description: 'Internal name for the new content'
          },
          displayName: {
            type: 'string',
            description: 'Display name for the new content'
          },
          properties: {
            type: 'object',
            description: 'Content properties',
            additionalProperties: true
          },
          language: {
            type: 'string',
            description: 'Language code',
            default: 'en'
          },
          autoConfirm: {
            type: 'boolean',
            description: 'Auto-select if multiple parents found',
            default: false
          }
        },
        required: ['parentName', 'contentType', 'name'],
        additionalProperties: false
      }
    },
    {
      name: 'content_creation_wizard',
      description: 'RECOMMENDED: Interactive wizard for content creation. Handles parent resolution, content type validation, and two-step creation process. Start with step="find-parent" and parentName="Home" (or desired parent).',
      inputSchema: {
        type: 'object',
        properties: {
          step: {
            type: 'string',
            description: 'Wizard step',
            enum: ['start', 'find-parent', 'create-content']
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
            description: 'Content type (for create-content step)'
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
            description: 'Content properties (for create-content step)',
            additionalProperties: true
          }
        },
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
  
  handlers.set('content_create_under', async (params, context) => 
    executeIntelligentCreate(graphConfig(context), cmaConfig(context), params)
  );
  
  handlers.set('content_creation_wizard', async (params, context) => 
    executeContentWizard(graphConfig(context), cmaConfig(context), params)
  );
}