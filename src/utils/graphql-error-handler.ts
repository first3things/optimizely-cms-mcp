import { GraphQLError } from 'graphql';
import { getLogger } from './logger.js';

export interface GraphQLErrorInfo {
  message: string;
  query?: string;
  variables?: Record<string, any>;
  suggestions?: string[];
  syntaxError?: {
    line: number;
    column: number;
    snippet: string;
  };
}

/**
 * Enhanced error handler for GraphQL queries
 */
export class GraphQLErrorHandler {
  private logger = getLogger();

  /**
   * Parse and enhance GraphQL errors
   */
  parseGraphQLError(error: any, query?: string, variables?: Record<string, any>): GraphQLErrorInfo {
    const errorInfo: GraphQLErrorInfo = {
      message: this.extractErrorMessage(error),
      query,
      variables
    };

    // Check for syntax errors
    if (this.isSyntaxError(error)) {
      errorInfo.syntaxError = this.extractSyntaxErrorDetails(error, query);
      errorInfo.suggestions = this.getSyntaxSuggestions(errorInfo.syntaxError, query);
    }

    // Check for field errors
    if (this.isFieldError(error)) {
      errorInfo.suggestions = this.getFieldSuggestions(error);
    }

    // Check for authentication errors
    if (this.isAuthError(error)) {
      errorInfo.suggestions = [
        'Check your authentication credentials',
        'Ensure your API key has the necessary permissions',
        'Verify the endpoint URL is correct'
      ];
    }

    return errorInfo;
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: any): string {
    if (error instanceof GraphQLError) {
      return error.message;
    }
    
    if (error?.response?.errors?.[0]) {
      return error.response.errors[0].message;
    }
    
    if (error?.message) {
      return error.message;
    }
    
    return 'Unknown GraphQL error';
  }

  /**
   * Check if error is a syntax error
   */
  private isSyntaxError(error: any): boolean {
    const message = this.extractErrorMessage(error).toLowerCase();
    return message.includes('syntax') || 
           message.includes('unexpected') ||
           message.includes('parse error') ||
           message.includes('expected');
  }

  /**
   * Check if error is a field error
   */
  private isFieldError(error: any): boolean {
    const message = this.extractErrorMessage(error).toLowerCase();
    return message.includes('field') && 
           (message.includes('not found') || 
            message.includes('does not exist') ||
            message.includes('unknown field'));
  }

  /**
   * Check if error is an authentication error
   */
  private isAuthError(error: any): boolean {
    const message = this.extractErrorMessage(error).toLowerCase();
    return message.includes('unauthorized') || 
           message.includes('forbidden') ||
           message.includes('authentication') ||
           message.includes('401') ||
           message.includes('403');
  }

  /**
   * Extract syntax error details
   */
  private extractSyntaxErrorDetails(error: any, query?: string): GraphQLErrorInfo['syntaxError'] {
    const message = this.extractErrorMessage(error);
    
    // Try to extract line and column from error message
    const lineMatch = message.match(/line (\d+)/i);
    const columnMatch = message.match(/column (\d+)/i);
    
    const line = lineMatch ? parseInt(lineMatch[1]) : 1;
    const column = columnMatch ? parseInt(columnMatch[1]) : 1;
    
    // Extract snippet around error location
    let snippet = '';
    if (query) {
      const lines = query.split('\n');
      const errorLine = lines[line - 1] || '';
      snippet = this.formatErrorSnippet(errorLine, column);
    }
    
    return { line, column, snippet };
  }

  /**
   * Format error snippet with pointer
   */
  private formatErrorSnippet(line: string, column: number): string {
    const pointer = ' '.repeat(Math.max(0, column - 1)) + '^';
    return `${line}\n${pointer}`;
  }

  /**
   * Get suggestions for syntax errors
   */
  private getSyntaxSuggestions(syntaxError: GraphQLErrorInfo['syntaxError'], query?: string): string[] {
    if (!syntaxError || !query) return [];
    
    const suggestions: string[] = [];
    const errorLine = query.split('\n')[syntaxError.line - 1] || '';
    
    // Check for common syntax issues
    if (errorLine.includes('..')) {
      suggestions.push('Remove duplicate dots (..)');
    }
    
    if (errorLine.includes(',,')) {
      suggestions.push('Remove duplicate commas (,,)');
    }
    
    if (errorLine.match(/\s\./)) {
      suggestions.push('Remove space before dot');
    }
    
    if (errorLine.includes('}{')) {
      suggestions.push('Add comma between objects');
    }
    
    // Check for unclosed brackets
    const openBraces = (query.match(/{/g) || []).length;
    const closeBraces = (query.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      suggestions.push(`Missing ${openBraces > closeBraces ? 'closing' : 'opening'} brace`);
    }
    
    const openParens = (query.match(/\(/g) || []).length;
    const closeParens = (query.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      suggestions.push(`Missing ${openParens > closeParens ? 'closing' : 'opening'} parenthesis`);
    }
    
    return suggestions;
  }

  /**
   * Get suggestions for field errors
   */
  private getFieldSuggestions(error: any): string[] {
    const message = this.extractErrorMessage(error);
    const suggestions: string[] = [];
    
    // Extract field name from error
    const fieldMatch = message.match(/field ['"`](\w+)['"`]/i);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      suggestions.push(`Run graph-introspection to discover available fields`);
      suggestions.push(`Check if '${fieldName}' exists in the schema`);
      
      // Common field name mistakes
      if (fieldName === 'id') {
        suggestions.push(`Try using '_metadata.key' instead of 'id'`);
      }
      
      if (fieldName === 'title') {
        suggestions.push(`Try using '_metadata.displayName' instead of 'title'`);
      }
    }
    
    return suggestions;
  }

  /**
   * Format error for display
   */
  formatError(errorInfo: GraphQLErrorInfo): string {
    const lines: string[] = [];
    
    lines.push(`GraphQL Error: ${errorInfo.message}`);
    
    if (errorInfo.syntaxError) {
      lines.push(`\nSyntax Error at line ${errorInfo.syntaxError.line}, column ${errorInfo.syntaxError.column}:`);
      lines.push(errorInfo.syntaxError.snippet);
    }
    
    if (errorInfo.suggestions && errorInfo.suggestions.length > 0) {
      lines.push('\nSuggestions:');
      errorInfo.suggestions.forEach(suggestion => {
        lines.push(`- ${suggestion}`);
      });
    }
    
    if (errorInfo.query && this.logger.level === 'debug') {
      lines.push('\nFull Query:');
      lines.push(errorInfo.query);
    }
    
    return lines.join('\n');
  }
}

// Singleton instance
let errorHandler: GraphQLErrorHandler | null = null;

/**
 * Get GraphQL error handler instance
 */
export function getGraphQLErrorHandler(): GraphQLErrorHandler {
  if (!errorHandler) {
    errorHandler = new GraphQLErrorHandler();
  }
  return errorHandler;
}

/**
 * Handle GraphQL error with enhanced information
 */
export function handleGraphQLError(
  error: any,
  query?: string,
  variables?: Record<string, any>
): never {
  const handler = getGraphQLErrorHandler();
  const errorInfo = handler.parseGraphQLError(error, query, variables);
  const formattedError = handler.formatError(errorInfo);
  
  throw new Error(formattedError);
}