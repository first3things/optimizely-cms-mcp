import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { handleError, OptimizelyError, ValidationError } from '../utils/errors.js';
import { getLogger } from '../utils/logger.js';
import type { Config } from '../config.js';
import type { Logger } from '../types/logger.js';

export interface ToolContext {
  config: Config;
  logger: Logger;
}

export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

export abstract class BaseTool<TInput = any, TOutput = any> {
  protected abstract readonly name: string;
  protected abstract readonly description: string;
  protected abstract readonly inputSchema: z.ZodSchema<TInput>;
  
  protected logger: Logger;
  
  constructor() {
    this.logger = getLogger();
  }
  
  /**
   * Get tool definition for MCP registration
   */
  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.zodToJsonSchema(this.inputSchema)
    };
  }
  
  /**
   * Execute the tool with proper error handling and validation
   */
  async execute(params: any, context: ToolContext): Promise<CallToolResult> {
    const startTime = Date.now();
    this.logger.info(`Executing tool: ${this.name}`, { params });
    
    try {
      // Validate input
      const validatedInput = await this.validateInput(params);
      
      // Execute tool logic
      const result = await this.run(validatedInput, context);
      
      // Format response
      const response = this.formatResponse(result);
      
      // Log success
      const duration = Date.now() - startTime;
      this.logger.info(`Tool ${this.name} completed successfully`, { duration });
      
      return response;
      
    } catch (error) {
      // Log error
      const duration = Date.now() - startTime;
      this.logger.error(`Tool ${this.name} failed`, { error, duration });
      
      // Handle error consistently
      return this.formatError(error);
    }
  }
  
  /**
   * The actual tool implementation
   */
  protected abstract run(input: TInput, context: ToolContext): Promise<TOutput>;
  
  /**
   * Validate input parameters
   */
  protected async validateInput(params: any): Promise<TInput> {
    try {
      return this.inputSchema.parse(params);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        throw new ValidationError(`Invalid input: ${issues}`, error.issues);
      }
      throw error;
    }
  }
  
  /**
   * Format successful response
   */
  protected formatResponse(data: TOutput): CallToolResult {
    return {
      content: [{
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      }]
    };
  }
  
  /**
   * Format error response
   */
  protected formatError(error: any): CallToolResult {
    return handleError(error);
  }
  
  /**
   * Convert Zod schema to JSON Schema for MCP
   */
  protected zodToJsonSchema(schema: z.ZodSchema): any {
    // This is a simplified converter - in production, use a library like zod-to-json-schema
    const def = (schema as any)._def;
    
    if (def.typeName === 'ZodObject') {
      const shape = def.shape();
      const properties: any = {};
      const required: string[] = [];
      
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodToJsonSchema(value as z.ZodSchema);
        if (!(value as any).isOptional()) {
          required.push(key);
        }
      }
      
      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
        additionalProperties: false
      };
    }
    
    if (def.typeName === 'ZodString') {
      const result: any = { type: 'string' };
      if (def.description) result.description = def.description;
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') result.minLength = check.value;
          if (check.kind === 'max') result.maxLength = check.value;
        }
      }
      return result;
    }
    
    if (def.typeName === 'ZodNumber') {
      const result: any = { type: 'number' };
      if (def.description) result.description = def.description;
      return result;
    }
    
    if (def.typeName === 'ZodBoolean') {
      const result: any = { type: 'boolean' };
      if (def.description) result.description = def.description;
      return result;
    }
    
    if (def.typeName === 'ZodArray') {
      return {
        type: 'array',
        items: this.zodToJsonSchema(def.type)
      };
    }
    
    if (def.typeName === 'ZodOptional') {
      return this.zodToJsonSchema(def.innerType);
    }
    
    if (def.typeName === 'ZodEnum') {
      return {
        type: 'string',
        enum: def.values
      };
    }
    
    if (def.typeName === 'ZodRecord') {
      return {
        type: 'object',
        additionalProperties: this.zodToJsonSchema(def.valueType)
      };
    }
    
    // Default fallback
    return { type: 'any' };
  }
  
  /**
   * Helper method for tools that need caching
   */
  protected getCacheKey(...parts: string[]): string {
    return ['tool', this.name, ...parts].join(':');
  }
  
  /**
   * Helper method for progress reporting
   */
  protected reportProgress(message: string, progress?: number): void {
    this.logger.info(`[${this.name}] ${message}`, { progress });
  }
}