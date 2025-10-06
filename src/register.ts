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
import { getIntelligentTools, registerIntelligentHandlers } from './tools/intelligent/register.js';
import { getHelperTools } from './tools/helper/register.js';
import { executeGetFullContentByPath } from './tools/helper/get-full-content.js';

// Import new tools
import { ToolRegistry } from './tools/tool-registry.js';
import { HelpTool } from './tools/implementations/help-tool.js';
import { DiscoverTool } from './tools/implementations/discover-tool.js';
import { AnalyzeTool } from './tools/implementations/analyze-tool.js';
import { SearchTool } from './tools/implementations/search-tool.js';
import { LocateTool } from './tools/implementations/locate-tool.js';
import { RetrieveTool } from './tools/implementations/retrieve-tool.js';
import { GetTool } from './tools/implementations/get-tool.js';

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
            enum: ['graph', 'content', 'assets', 'types', 'workflow', 'composite', 'utility', 'intelligent', 'helper'],
            description: 'Tool category to filter documentation'
          }
        },
        additionalProperties: false
      }
    }
  ];

  // Register new tools using ToolRegistry
  const toolRegistry = new ToolRegistry(config);

  // Register new tools FIRST (they should be preferred)
  toolRegistry.register(new HelpTool());
  toolRegistry.register(new GetTool());  // 🚀 NEW UNIFIED TOOL - Use this first!
  toolRegistry.register(new DiscoverTool());
  toolRegistry.register(new AnalyzeTool());
  toolRegistry.register(new SearchTool());
  toolRegistry.register(new LocateTool());
  toolRegistry.register(new RetrieveTool());
  
  // Get new tool definitions
  const newTools = toolRegistry.getTools();
  
  // Combine all tools - new tools first!
  const tools: Tool[] = [
    ...newTools,  // New tools at the beginning
    ...utilityTools,
    ...getGraphTools(),
    ...getContentTools(),
    ...getIntelligentTools(),
    ...getHelperTools()
  ];

  // Create handler map
  const handlers = new Map<string, (params: any, context: ToolContext) => Promise<any>>();
  
  // Register graph handlers
  registerGraphHandlers(handlers);
  
  // Register content handlers
  registerContentHandlers(handlers);
  
  // Register intelligent handlers
  registerIntelligentHandlers(handlers);
  
  // Register helper handlers
  handlers.set('get-full-content-by-path', async (params: any, ctx: ToolContext) => {
    return executeGetFullContentByPath(ctx.config, params);
  });

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
      // Check new tools first (they use the ToolRegistry)
      if (toolRegistry.hasHandler(name)) {
        return await toolRegistry.handleToolCall(name, args || {}, context);
      }
      
      // Check if we have a handler for legacy tools
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
      utility: 'Helper and utility tools',
      intelligent: 'Smart content creation with parent discovery',
      helper: 'Helper tools for content operations'
    }
  };

  // Get all available tools grouped by category
  const toolsByCategory: Record<string, string[]> = {
    // NEW TOOLS (Recommended - use these first!)
    'discovery-first': [
      'help',      // 🚀 START HERE - Learn the discovery-first workflow
      'get',       // 🌟 NEW! Get content by ANY identifier in ONE call
      'discover',  // Find content types and fields dynamically
      'analyze',   // Deep analysis of content types
      'search',    // ⚠️ Prefer 'get' - Intelligent content search
      'locate',    // ⚠️ Prefer 'get' - Find content by ID/path
      'retrieve'   // ⚠️ Prefer 'get' - Get full content details
    ],
    utility: ['health-check', 'get-config', 'get-documentation'],
    // LEGACY TOOLS (Being phased out - use new tools above)
    graph: [
      'graph-query',         // ⚠️ Use 'search' instead
      'graph-introspection'  // ⚠️ Use 'discover' instead
    ],
    content: [
      'content-test-api',
      'type-discover',       // ⚠️ Use 'discover' instead
      'type-match',          // ⚠️ Use 'discover' instead
      'content_type_analyzer' // ⚠️ Use 'analyze' instead
    ],
    assets: [],  // Empty - no asset tools implemented
    types: [],   // Empty - type tools merged into content category
    workflow: [], // Empty - no workflow tools implemented
    composite: [], // Empty - no composite tools implemented
    intelligent: [
      'content_creation_wizard',
      'graph_discover_types',  // ⚠️ Use 'discover' instead
      'graph_discover_fields'  // ⚠️ Use 'discover' instead
    ],
    helper: [
      'get-full-content-by-path' // ⚠️ Use 'search' + 'retrieve' instead
    ]
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