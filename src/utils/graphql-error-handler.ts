/**
 * GraphQL Error Handler
 * 
 * This module has been consolidated into the main error handling system (errors.ts).
 * The functionality is now available through the GraphQLError class and related utilities.
 * 
 * @deprecated Use the error handling utilities from './errors.js' instead
 */

import { GraphQLError as GraphQLErrorClass } from './errors.js';

// Re-export for backward compatibility
export { GraphQLErrorClass as GraphQLError };

// Deprecated - for backward compatibility only
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
 * @deprecated Use error handling from errors.ts instead
 */
export function handleGraphQLError(
  error: any,
  query?: string,
  variables?: Record<string, any>
): never {
  // This now just throws a GraphQLError which will be handled by the main error handler
  throw error;
}