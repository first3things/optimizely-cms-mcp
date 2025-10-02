import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getLogger } from './logger.js';

const logger = getLogger();

export class OptimizelyError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'OptimizelyError';
  }
}

export class AuthenticationError extends OptimizelyError {
  constructor(message: string, details?: any) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

export class APIError extends OptimizelyError {
  constructor(message: string, statusCode: number, details?: any) {
    super(message, 'API_ERROR', statusCode, details);
    this.name = 'APIError';
  }
}

export class ValidationError extends OptimizelyError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends OptimizelyError {
  constructor(message: string, details?: any) {
    super(message, 'NOT_FOUND', 404, details);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends OptimizelyError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends OptimizelyError {
  constructor(message: string, timeout: number) {
    super(message, 'TIMEOUT', 408, { timeout });
    this.name = 'TimeoutError';
  }
}

export class GraphQLError extends OptimizelyError {
  constructor(
    message: string,
    public query?: string,
    public variables?: Record<string, any>,
    public syntaxError?: {
      line: number;
      column: number;
      snippet: string;
    },
    public suggestions?: string[]
  ) {
    super(message, 'GRAPHQL_ERROR', 400, { query, variables, syntaxError, suggestions });
    this.name = 'GraphQLError';
  }
}

export function handleError(error: any): CallToolResult {
  logger.error('Tool execution error:', error);

  if (error instanceof OptimizelyError) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: formatErrorMessage(error)
      }]
    };
  }

  // Handle fetch/network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Network error: ${error.message}`
      }]
    };
  }

  // Handle GraphQL errors
  if (error.response?.errors || error.errors) {
    const graphQLError = parseGraphQLError(error);
    return {
      isError: true,
      content: [{
        type: 'text',
        text: formatGraphQLError(graphQLError)
      }]
    };
  }

  // Generic error
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `Unexpected error: ${error.message || error}`
    }]
  };
}

function formatErrorMessage(error: OptimizelyError): string {
  let message = `Error: ${error.message}\nCode: ${error.code}`;
  
  if (error.statusCode) {
    message += `\nStatus: ${error.statusCode}`;
  }
  
  if (error.details) {
    message += `\nDetails: ${JSON.stringify(error.details, null, 2)}`;
  }
  
  return message;
}

export function isRetryableError(error: any): boolean {
  if (error instanceof OptimizelyError) {
    // Retry on rate limit, timeout, and 5xx errors
    return error.statusCode === 429 || 
           error.statusCode === 408 ||
           (error.statusCode !== undefined && error.statusCode >= 500);
  }
  
  // Retry on network errors
  return error instanceof TypeError && error.message.includes('fetch');
}

/**
 * Parse GraphQL errors with enhanced information
 */
function parseGraphQLError(error: any): GraphQLError {
  const message = extractGraphQLErrorMessage(error);
  const query = error.request?.query || error.query;
  const variables = error.request?.variables || error.variables;
  
  let syntaxError;
  let suggestions: string[] = [];
  
  // Check for syntax errors
  if (isSyntaxError(message)) {
    syntaxError = extractSyntaxErrorDetails(message, query);
    suggestions = getSyntaxSuggestions(syntaxError, query);
  }
  
  // Check for field errors
  if (isFieldError(message)) {
    suggestions = getFieldSuggestions(message);
  }
  
  // Check for auth errors
  if (isAuthError(message)) {
    suggestions = [
      'Check your authentication credentials',
      'Ensure your API key has the necessary permissions',
      'Verify the endpoint URL is correct'
    ];
  }
  
  return new GraphQLError(message, query, variables, syntaxError, suggestions);
}

function extractGraphQLErrorMessage(error: any): string {
  if (error.response?.errors?.[0]) {
    return error.response.errors[0].message;
  }
  if (error.errors?.[0]) {
    return error.errors[0].message;
  }
  if (error.message) {
    return error.message;
  }
  return 'Unknown GraphQL error';
}

function isSyntaxError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('syntax') || 
         lower.includes('unexpected') ||
         lower.includes('parse error') ||
         lower.includes('expected');
}

function isFieldError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('field') && 
         (lower.includes('not found') || 
          lower.includes('does not exist') ||
          lower.includes('unknown field'));
}

function isAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('unauthorized') || 
         lower.includes('forbidden') ||
         lower.includes('authentication') ||
         lower.includes('401') ||
         lower.includes('403');
}

function extractSyntaxErrorDetails(message: string, query?: string): { line: number; column: number; snippet: string } | undefined {
  const lineMatch = message.match(/line (\d+)/i);
  const columnMatch = message.match(/column (\d+)/i);
  
  if (!lineMatch || !columnMatch) return undefined;
  
  const line = parseInt(lineMatch[1]);
  const column = parseInt(columnMatch[1]);
  
  let snippet = '';
  if (query) {
    const lines = query.split('\n');
    const errorLine = lines[line - 1] || '';
    snippet = `${errorLine}\n${' '.repeat(Math.max(0, column - 1))}^`;
  }
  
  return { line, column, snippet };
}

function getSyntaxSuggestions(syntaxError?: { line: number; column: number; snippet: string }, query?: string): string[] {
  if (!syntaxError || !query) return [];
  
  const suggestions: string[] = [];
  const errorLine = query.split('\n')[syntaxError.line - 1] || '';
  
  if (errorLine.includes('..')) suggestions.push('Remove duplicate dots (..)');
  if (errorLine.includes(',,')) suggestions.push('Remove duplicate commas (,,)');
  if (errorLine.match(/\s\./)) suggestions.push('Remove space before dot');
  if (errorLine.includes('}{')) suggestions.push('Add comma between objects');
  
  // Check for unclosed brackets
  const openBraces = (query.match(/{/g) || []).length;
  const closeBraces = (query.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    suggestions.push(`Missing ${openBraces > closeBraces ? 'closing' : 'opening'} brace`);
  }
  
  return suggestions;
}

function getFieldSuggestions(message: string): string[] {
  const suggestions: string[] = [];
  const fieldMatch = message.match(/field ['"\`](\w+)['"\`]/i);
  
  if (fieldMatch) {
    const fieldName = fieldMatch[1];
    suggestions.push(`Run graph-introspection to discover available fields`);
    suggestions.push(`Check if '${fieldName}' exists in the schema`);
    
    if (fieldName === 'id') suggestions.push(`Try using '_metadata.key' instead of 'id'`);
    if (fieldName === 'title') suggestions.push(`Try using '_metadata.displayName' instead of 'title'`);
  }
  
  return suggestions;
}

function formatGraphQLError(error: GraphQLError): string {
  const lines: string[] = [];
  
  lines.push(`GraphQL Error: ${error.message}`);
  
  if (error.syntaxError) {
    lines.push(`\nSyntax Error at line ${error.syntaxError.line}, column ${error.syntaxError.column}:`);
    lines.push(error.syntaxError.snippet);
  }
  
  if (error.suggestions && error.suggestions.length > 0) {
    lines.push('\nSuggestions:');
    error.suggestions.forEach(suggestion => lines.push(`- ${suggestion}`));
  }
  
  return lines.join('\n');
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      // Handle rate limit with retry-after header
      if (error instanceof RateLimitError && error.details?.retryAfter) {
        delay = error.details.retryAfter * 1000;
      }

      logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Exponential backoff
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}