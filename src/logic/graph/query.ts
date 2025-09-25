import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { GraphConfig } from '../../types/config.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { validateGraphQLQuery } from '../../utils/validation.js';

export async function executeGraphQuery(
  config: GraphConfig,
  params: {
    query: string;
    variables?: Record<string, any>;
    operationName?: string;
  }
): Promise<CallToolResult> {
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
        text: JSON.stringify(result, null, 2)
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

    const client = new OptimizelyGraphClient(config);
    
    // Normalize path
    const normalizedPath = params.path.startsWith('/') ? params.path : `/${params.path}`;
    
    const fieldsSelection = params.fields 
      ? params.fields.join('\n          ')
      : '';

    const query = `
      query GetContentByPath($path: String!) {
        content: _Content(
          where: { 
            _metadata: { 
              url: { hierarchical: { eq: $path } }
              locale: { eq: "en" }
            }
          }
          limit: 1
        ) {
          items {
            _metadata {
              key
              locale
              displayName
              types
              url {
                base
                hierarchical
              }
            }${fieldsSelection ? `
            ${fieldsSelection}` : ''}
          }
        }
      }
    `;

    const variables = {
      path: normalizedPath
    };

    const result = await client.query(query, variables, {
      operationName: 'GetContentByPath'
    });

    const content = (result as any).content?.items?.[0];
    
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

    const client = new OptimizelyGraphClient(config);
    const direction = params.direction || 'outgoing';
    const limit = params.limit || 20;
    
    const query = direction === 'outgoing' ? `
      query GetOutgoingRelations($contentId: String!, $limit: Int) {
        content: _Content(
          where: { 
            _or: [
              { _metadata: { key: { eq: $contentId } } }
              { contentLink: { id: { eq: $contentId } } }
            ]
          }
          limit: 1
        ) {
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
              ... on _IContent {
                name
                contentLink {
                  id
                  guidValue
                }
              }
            }
          }
        }
      }
    ` : `
      query GetIncomingRelations($contentId: String!, $limit: Int) {
        content: _Content(
          where: {
            _references: {
              _metadata: { key: { eq: $contentId } }
            }
          }
          limit: $limit
        ) {
          items {
            _metadata {
              key
              displayName
              types
            }
            ... on _IContent {
              name
              contentLink {
                id
                guidValue
              }
            }
          }
          total
        }
      }
    `;

    const variables = {
      contentId: params.contentId,
      limit
    };

    const result = await client.query(query, variables, {
      operationName: direction === 'outgoing' ? 'GetOutgoingRelations' : 'GetIncomingRelations'
    });

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