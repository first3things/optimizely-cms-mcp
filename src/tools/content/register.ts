/**
 * Optimizely Content Management API (CMA) Tools
 * 
 * Temporary reduced set during migration to new 10-tool architecture
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../../types/tools.js';
import { getCMAConfig } from '../../config.js';
import {
  executeContentTypeDiscovery,
  executeSmartContentTypeMatch
} from '../../logic/types/smart-discovery.js';
import {
  executeTestContentApi
} from '../../logic/content/site-info.js';
import { contentTypeAnalyzerTool } from '../content-type-analyzer.js';

export function getContentTools(): Tool[] {
  return [
    // Keep only essential discovery and health tools during migration
    {
      name: 'content-test-api',
      description: 'Test Content Management API connectivity and available endpoints',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'type-discover',
      description: 'Discover content types with smart matching',
      inputSchema: {
        type: 'object',
        properties: {
          suggestedType: {
            type: 'string',
            description: 'The type you\'re looking for'
          },
          includeDescriptions: {
            type: 'boolean',
            description: 'Include type descriptions',
            default: false
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'type-match',
      description: 'Smart match a requested content type to available types',
      inputSchema: {
        type: 'object',
        properties: {
          requestedType: {
            type: 'string',
            description: 'The content type name to match'
          },
          context: {
            type: 'string',
            description: 'Additional context to help matching'
          }
        },
        required: ['requestedType'],
        additionalProperties: false
      }
    },
    {
      name: 'content_type_analyzer',
      description: 'Analyze a content type to understand its requirements, fields, and smart defaults',
      inputSchema: {
        type: 'object',
        properties: {
          contentType: {
            type: 'string',
            description: 'The content type to analyze'
          },
          includeExamples: {
            type: 'boolean',
            description: 'Include example values for fields',
            default: true
          },
          includeInherited: {
            type: 'boolean',
            description: 'Include inherited properties from base types',
            default: true
          }
        },
        required: ['contentType'],
        additionalProperties: false
      }
    }
  ];
}

export function registerContentHandlers(
  handlers: Map<string, (params: any, context: ToolContext) => Promise<any>>
): void {
  const cmaConfig = (context: ToolContext) => getCMAConfig(context.config);

  handlers.set('content-test-api', async (params, context) => 
    executeTestContentApi(cmaConfig(context), params)
  );

  handlers.set('type-discover', async (params, context) => 
    executeContentTypeDiscovery(cmaConfig(context), params)
  );
  
  handlers.set('type-match', async (params, context) => 
    executeSmartContentTypeMatch(cmaConfig(context), params)
  );

  handlers.set('content_type_analyzer', async (params, context) => 
    contentTypeAnalyzerTool.handler(params, context.config)
  );
}