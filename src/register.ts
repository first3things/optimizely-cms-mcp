import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Config } from './config.js';
import { getLogger } from './utils/logger.js';
import { getCacheManager } from './utils/cache.js';
import { handleError } from './utils/errors.js';
import type { ToolContext } from './types/tools.js';
import type { Tool, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { getGraphTools, registerGraphHandlers } from './tools/graph/register.js';
import { getContentTools, registerContentHandlers } from './tools/content/register.js';

export async function registerAllTools(server: Server, config: Config): Promise<void> {
  const logger = getLogger();
  const cache = getCacheManager();
  
  // Create shared context for all tools
  const context: ToolContext = {
    config,
    logger,
    cache
  };

  // Define available tools
  const utilityTools: Tool[] = [
    {
      name: 'health-check',
      description: 'Check API connectivity and server health',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'get-config',
      description: 'Get current server configuration (sanitized)',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'get-documentation',
      description: 'Get documentation for available tools',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['graph', 'content', 'assets', 'types', 'workflow', 'composite', 'utility'],
            description: 'Tool category to filter documentation'
          }
        },
        additionalProperties: false
      }
    }
  ];

  // Combine all tools
  const tools: Tool[] = [
    ...utilityTools,
    ...getGraphTools(),
    ...getContentTools()
  ];

  // Create handler map
  const handlers = new Map<string, (params: any, context: ToolContext) => Promise<any>>();
  
  // Register graph handlers
  registerGraphHandlers(handlers);
  
  // Register content handlers
  registerContentHandlers(handlers);

  // Register capabilities
  server.registerCapabilities({
    tools: {
      list: tools
    }
  });

  // Create request schemas
  const listToolsSchema = z.object({
    method: z.literal('tools/list'),
    params: z.object({}).optional()
  });

  const callToolSchema = z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.string(),
      arguments: z.record(z.any()).optional()
    })
  });

  // Handle tool list requests
  server.setRequestHandler(listToolsSchema, async (): Promise<ListToolsResult> => ({
    tools
  }));

  // Handle tool call requests
  server.setRequestHandler(callToolSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    logger.debug(`Tool ${name} called`, { args });

    try {
      // Check if we have a handler for this tool
      const handler = handlers.get(name);
      if (handler) {
        return await handler(args || {}, context);
      }

      // Handle utility tools
      switch (name) {
        case 'health-check':
          return await handleHealthCheck(context);
        
        case 'get-config':
          return await handleGetConfig(context);
        
        case 'get-documentation':
          return await handleGetDocumentation(args || {}, context);
        
        default:
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Unknown tool: ${name}`
            }]
          };
      }
    } catch (error) {
      logger.error(`Tool ${name} failed`, error);
      return handleError(error);
    }
  });

  logger.info(`Registered ${tools.length} tools`);
}

async function handleHealthCheck(context: ToolContext) {
  const { config, logger } = context;
  
  logger.info('Health check requested');
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'healthy',
        server: {
          name: config.server.name,
          version: config.server.version
        },
        configuration: {
          graphEndpoint: config.graph.endpoint,
          cmaBaseUrl: config.cma.baseUrl,
          cacheEnabled: true,
          cacheTtl: config.options.cacheTtl
        },
        timestamp: new Date().toISOString()
      }, null, 2)
    }]
  };
}

async function handleGetConfig(context: ToolContext) {
  const { config, logger } = context;
  
  logger.info('Configuration requested');
  
  // Sanitize config to remove sensitive data
  const sanitizedConfig = {
    server: config.server,
    graph: {
      endpoint: config.graph.endpoint,
      authMethod: config.graph.authMethod
    },
    cma: {
      baseUrl: config.cma.baseUrl,
      grantType: config.cma.grantType,
      scope: config.cma.scope
    },
    options: config.options
  };
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(sanitizedConfig, null, 2)
    }]
  };
}

async function handleGetDocumentation(params: { category?: string }, context: ToolContext) {
  const { logger } = context;
  
  logger.info('Documentation requested', { category: params.category });
  
  const docs: any = {
    overview: 'Optimizely MCP Server provides tools for interacting with Optimizely CMS',
    categories: {
      graph: 'GraphQL query tools for content retrieval',
      content: 'Content management operations',
      assets: 'Media and asset management',
      types: 'Content type operations',
      workflow: 'Workflow management',
      composite: 'Complex multi-step operations',
      utility: 'Helper and utility tools'
    }
  };

  // Get all available tools grouped by category
  const toolsByCategory: Record<string, string[]> = {
    utility: ['health-check', 'get-config', 'get-documentation'],
    graph: [
      'graph-query',
      'graph-introspection',
      'graph-search',
      'graph-autocomplete',
      'graph-faceted-search',
      'graph-get-content',
      'graph-get-content-by-path',
      'graph-get-children',
      'graph-get-ancestors',
      'graph-get-related'
    ],
    content: [
      'content-create',
      'content-get',
      'content-update',
      'content-patch',
      'content-delete',
      'content-move',
      'content-copy',
      'content-list-versions',
      'content-create-version',
      'content-promote-version',
      'content-list-languages',
      'content-create-language-branch'
    ],
    assets: [],  // Will be added in Phase 4
    types: [
      'type-list',
      'type-get',
      'type-get-schema'
    ],
    workflow: [
      'workflow-get-status',
      'workflow-transition'
    ],
    composite: [] // Will be added in Phase 5
  };

  if (params.category) {
    docs.tools = toolsByCategory[params.category] || [];
  } else {
    docs.availableTools = Object.values(toolsByCategory).flat();
  }
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(docs, null, 2)
    }]
  };
}