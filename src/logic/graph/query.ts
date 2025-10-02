import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { GraphConfig } from '../../types/config.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { validateGraphQLQuery } from '../../utils/validation.js';
import { createQueryAdapter } from './query-adapter.js';
import { getLogger } from '../../utils/logger.js';

export async function executeGraphQuery(
  config: GraphConfig,
  params: {
    query: string;
    variables?: Record<string, any>;
    operationName?: string;
  }
): Promise<CallToolResult> {
  const logger = getLogger();
  let warningMessage = '';
  
  // Check if user is trying to search and guide them to the new tools
  const query = params.query.toLowerCase();
  if (query.includes('where') && (query.includes('name') || query.includes('title') || query.includes('match'))) {
    logger.warn('User attempting to search with graph-query instead of new search tool');
    
    warningMessage = `⚠️ NOTICE: You're using the deprecated graph-query tool for searching.

🚀 Please use the new discovery-first workflow instead:
1. help({}) - Learn the correct workflow
2. discover({"target": "types"}) - Find content types
3. discover({"target": "fields", "contentType": "ArticlePage"}) - Find fields
4. search({"query": "your search", "contentTypes": ["ArticlePage"]}) - Search content

The new tools automatically discover fields and build optimal queries!

--- Query execution continues below ---
`;
  }
  
  try {
    // Validate query
    validateGraphQLQuery(params.query);
    
    const client = new OptimizelyGraphClient(config);
    
    const result = await client.query(
      params.query,
      params.variables,
      {
        operationName: params.operationName
      }
    );

    return {
      content: [{
        type: 'text',
        text: warningMessage + JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeGraphIntrospection(
  config: GraphConfig
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyGraphClient(config);
    const schema = await client.introspect();
    
    // Format the schema for better readability
    const formattedSchema = {
      queryType: schema.__schema.queryType?.name,
      mutationType: schema.__schema.mutationType?.name,
      subscriptionType: schema.__schema.subscriptionType?.name,
      types: schema.__schema.types
        .filter(type => !type.name.startsWith('__'))
        .map(type => ({
          name: type.name,
          kind: type.kind,
          description: type.description,
          fields: (type as any).fields?.map((field: any) => ({
            name: field.name,
            type: formatType(field.type),
            description: field.description
          }))
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(formattedSchema, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeGraphGetContentByPath(
  config: GraphConfig,
  params: {
    path: string;
    locale?: string;
    fields?: string[];
  }
): Promise<CallToolResult> {
  try {
    if (!params.path) {
      throw new ValidationError('Path is required');
    }

    const logger = getLogger();
    const queryAdapter = await createQueryAdapter(config);
    
    logger.debug(`Using ${queryAdapter.getMode()} query builder`);
    
    // Normalize path
    const normalizedPath = params.path.startsWith('/') ? params.path : `/${params.path}`;
    
    // Build query using the adapter
    const query = await queryAdapter.buildGetContentByPathQuery({
      path: normalizedPath,
      locale: params.locale || 'en',
      includeAllFields: !params.fields || params.fields.length === 0,
      options: {
        includeFields: params.fields,
        maxDepth: 2
      }
    });

    const variableGenerators = queryAdapter.getVariableGenerators();
    const variables = variableGenerators.path(
      normalizedPath,
      params.locale || 'en'
    );

    const result = await queryAdapter.executeQuery(query, variables);

    // Handle different response structures
    const content = (result as any).content?.items?.[0] || 
                   (result as any)._Content?.items?.[0] ||
                   (result as any).Content?.items?.[0];
    
    if (!content) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Content not found at path', path: normalizedPath }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(content, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeGraphGetRelated(
  config: GraphConfig,
  params: {
    contentId: string;
    relationshipType?: string;
    direction?: 'incoming' | 'outgoing';
    limit?: number;
  }
): Promise<CallToolResult> {
  try {
    if (!params.contentId) {
      throw new ValidationError('Content ID is required');
    }

    const logger = getLogger();
    const queryAdapter = await createQueryAdapter(config);
    const direction = params.direction || 'outgoing';
    const limit = params.limit || 20;
    
    logger.debug(`Using ${queryAdapter.getMode()} query builder for related content`);
    
    // For now, build a simple related content query
    // The dynamic builder doesn't have this method yet, so we'll build it manually
    const query = `
      query GetRelatedContent($contentId: String!, $limit: Int) {
        ${direction === 'outgoing' ? 
          `_Content(where: { _metadata: { key: { eq: $contentId } } }, limit: 1) {
            items {
              _metadata {
                key
                displayName
              }
              _references(limit: $limit) {
                _metadata {
                  key
                  displayName
                  types
                }
              }
            }
          }` :
          `_Content(where: { _references: { _metadata: { key: { eq: $contentId } } } }, limit: $limit) {
            items {
              _metadata {
                key
                displayName
                types
              }
            }
            total
          }`
        }
      }
    `;

    const variables = {
      contentId: params.contentId,
      limit
    };

    const result = await queryAdapter.executeQuery(query, variables);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

// Helper function to format GraphQL types for introspection
function formatType(type: any): string {
  if (type.kind === 'NON_NULL') {
    return `${formatType(type.ofType)}!`;
  }
  if (type.kind === 'LIST') {
    return `[${formatType(type.ofType)}]`;
  }
  return type.name || 'Unknown';
}