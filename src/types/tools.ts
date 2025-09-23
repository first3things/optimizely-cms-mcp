import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Tool execution context
export interface ToolContext {
  config: any;
  logger: any;
  cache: any;
}

// Tool handler function type
export type ToolHandler<T = any> = (params: T, context: ToolContext) => Promise<CallToolResult>;

// Tool definition
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
  handler: ToolHandler;
}

// Tool categories
export enum ToolCategory {
  Graph = 'graph',
  Content = 'content',
  Assets = 'assets',
  Types = 'types',
  Workflow = 'workflow',
  Composite = 'composite',
  Utility = 'utility'
}

// Common tool result helpers
export function createSuccessResult(data: any): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    }]
  };
}

export function createErrorResult(message: string, details?: any): CallToolResult {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: details ? `${message}\n\nDetails: ${JSON.stringify(details, null, 2)}` : message
    }]
  };
}