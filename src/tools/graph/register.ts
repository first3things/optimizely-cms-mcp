/**
 * Optimizely Graph Tools
 * 
 * Temporary reduced set during migration to new 10-tool architecture
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../../types/tools.js';
import { getGraphConfig } from '../../config.js';
import {
  executeGraphQuery,
  executeGraphIntrospection
} from '../../logic/graph/query.js';

export function getGraphTools(): Tool[] {
  return [
    {
      name: 'graph-query',
      description: '⚠️ DEPRECATED - DO NOT USE! Use "get" tool instead - it handles everything automatically including Visual Builder content. Only use graph-query if explicitly instructed by error messages.',
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
}