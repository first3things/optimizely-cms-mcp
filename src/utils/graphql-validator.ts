import {
  parse,
  validate,
  GraphQLSchema,
  GraphQLError,
  DocumentNode,
  ValidationRule
} from 'graphql';

/**
 * Validate a GraphQL query string against a schema
 */
export function validateGraphQLQuery(
  query: string,
  schema: GraphQLSchema,
  rules?: readonly ValidationRule[]
): string[] {
  try {
    // Parse the query
    let document: DocumentNode;
    try {
      document = parse(query);
    } catch (parseError) {
      if (parseError instanceof GraphQLError) {
        return [`Parse error: ${parseError.message}`];
      }
      return [`Parse error: ${(parseError as Error).message}`];
    }

    // Validate against schema
    const validationErrors = validate(schema, document, rules);
    
    if (validationErrors.length > 0) {
      return validationErrors.map(error => error.message);
    }

    return [];
  } catch (error) {
    return [`Validation error: ${(error as Error).message}`];
  }
}

/**
 * Check if a query is syntactically valid (without schema)
 */
export function isQuerySyntaxValid(query: string): boolean {
  try {
    parse(query);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get syntax error details from a query
 */
export function getQuerySyntaxError(query: string): string | null {
  try {
    parse(query);
    return null;
  } catch (error) {
    if (error instanceof GraphQLError) {
      return error.message;
    }
    return (error as Error).message;
  }
}

/**
 * Format a GraphQL query for better readability
 */
export function formatGraphQLQuery(query: string): string {
  try {
    const document = parse(query);
    
    // Simple formatter - in production, use graphql-js print function
    return query
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  } catch {
    // If parsing fails, return original
    return query;
  }
}

/**
 * Extract operation names from a GraphQL document
 */
export function getOperationNames(query: string): string[] {
  try {
    const document = parse(query);
    const operations: string[] = [];

    document.definitions.forEach(def => {
      if (def.kind === 'OperationDefinition' && def.name) {
        operations.push(def.name.value);
      }
    });

    return operations;
  } catch {
    return [];
  }
}

/**
 * Check if a query contains a specific operation
 */
export function hasOperation(query: string, operationName: string): boolean {
  const operations = getOperationNames(query);
  return operations.includes(operationName);
}