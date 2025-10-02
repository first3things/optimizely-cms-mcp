import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BaseTool, ToolContext } from './base-tool.js';
import { getLogger } from '../utils/logger.js';
import { handleError } from '../utils/errors.js';
import type { Config } from '../config.js';

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  private context: ToolContext;
  private logger = getLogger();
  
  constructor(config: Config) {
    this.context = {
      config,
      logger: this.logger
    };
  }
  
  /**
   * Register a tool instance
   */
  register(tool: BaseTool): void {
    const definition = tool.getDefinition();
    this.tools.set(definition.name, tool);
    this.logger.info(`Registered tool: ${definition.name}`);
  }
  
  /**
   * Register multiple tools
   */
  registerAll(tools: BaseTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }
  
  /**
   * Get all registered tools
   */
  getTools(): ListToolsResult['tools'] {
    return Array.from(this.tools.values()).map(tool => tool.getDefinition());
  }
  
  /**
   * Check if a handler exists for a tool
   */
  hasHandler(name: string): boolean {
    return this.tools.has(name);
  }
  
  /**
   * Handle a tool call (alias for execute)
   */
  async handleToolCall(name: string, args: any, context?: ToolContext): Promise<CallToolResult> {
    // Update context if provided
    if (context) {
      this.context = context;
    }
    return this.execute(name, args);
  }
  
  /**
   * Execute a tool by name
   */
  async execute(name: string, args: any): Promise<CallToolResult> {
    const tool = this.tools.get(name);
    
    if (!tool) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Unknown tool: ${name}`
        }]
      };
    }
    
    try {
      return await tool.execute(args, this.context);
    } catch (error) {
      this.logger.error(`Tool execution failed: ${name}`, error);
      return handleError(error);
    }
  }
  
  /**
   * Set up MCP server with registered tools
   */
  setupServer(server: Server): void {
    // Register capabilities
    server.registerCapabilities({
      tools: {
        list: this.getTools()
      }
    });
    
    // Handle tool list requests
    const listToolsSchema = z.object({
      method: z.literal('tools/list'),
      params: z.object({}).optional()
    });
    
    server.setRequestHandler(listToolsSchema, async (): Promise<ListToolsResult> => ({
      tools: this.getTools()
    }));
    
    // Handle tool call requests
    const callToolSchema = z.object({
      method: z.literal('tools/call'),
      params: z.object({
        name: z.string(),
        arguments: z.record(z.any()).optional()
      })
    });
    
    server.setRequestHandler(callToolSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.execute(name, args || {});
    });
    
    this.logger.info(`Registered ${this.tools.size} tools with MCP server`);
  }
}