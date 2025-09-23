import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { Config } from './config.js';
import { getLogger } from './utils/logger.js';
import { getCacheManager } from './utils/cache.js';
import { handleError } from './utils/errors.js';
import type { ToolContext } from './types/tools.js';
import type { Tool, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

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
  const tools: Tool[] = [
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
  
  // This will be expanded to return actual documentation
  const docs = {
    overview: 'Optimizely MCP Server provides tools for interacting with Optimizely CMS',
    categories: {
      graph: 'GraphQL query tools for content retrieval',
      content: 'Content management operations',
      assets: 'Media and asset management',
      types: 'Content type operations',
      workflow: 'Workflow management',
      composite: 'Complex multi-step operations',
      utility: 'Helper and utility tools'
    },
    availableTools: [
      'health-check',
      'get-config',
      'get-documentation'
    ]
  };
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(docs, null, 2)
    }]
  };
}