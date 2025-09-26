import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { GraphConfig } from '../../types/config.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { createIntelligentQueryBuilder } from './intelligent-query-builder.js';

/**
 * Get available content types discovered from the schema
 */
export async function executeGetContentTypes(
  config: GraphConfig
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyGraphClient(config);
    const queryBuilder = await createIntelligentQueryBuilder(config);
    
    const contentTypes = await queryBuilder.getContentTypes();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          contentTypes,
          total: contentTypes.length
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Get fields available for a specific content type
 */
export async function executeGetFieldsForType(
  config: GraphConfig,
  params: {
    typeName: string;
  }
): Promise<CallToolResult> {
  try {
    if (!params.typeName) {
      throw new ValidationError('Type name is required');
    }
    
    const client = new OptimizelyGraphClient(config);
    const queryBuilder = await createIntelligentQueryBuilder(config);
    
    const fields = await queryBuilder.getFieldsForType(params.typeName);
    
    // Format fields for better readability
    const formattedFields = fields.map(field => ({
      name: field.name,
      type: formatFieldType(field.type),
      description: field.description,
      isRequired: field.type.kind === 'NON_NULL'
    }));
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          typeName: params.typeName,
          fields: formattedFields,
          fieldCount: formattedFields.length
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Build and execute a custom query using the intelligent query builder
 */
export async function executeIntelligentQuery(
  config: GraphConfig,
  params: {
    operation: 'search' | 'getContent' | 'getByPath' | 'facetedSearch' | 'related';
    searchTerm?: string;
    contentId?: string;
    path?: string;
    contentTypes?: string[];
    locale?: string;
    limit?: number;
    skip?: number;
    includeAllFields?: boolean;
    maxDepth?: number;
    direction?: 'incoming' | 'outgoing';
    facets?: Record<string, { field: string; limit?: number }>;
    filters?: Record<string, any>;
  }
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyGraphClient(config);
    const queryBuilder = await createIntelligentQueryBuilder(config);
    
    let query: string;
    let variables: Record<string, any> = {};
    let operationName: string;
    
    switch (params.operation) {
      case 'search':
        if (!params.searchTerm) {
          throw new ValidationError('Search term is required for search operation');
        }
        query = await queryBuilder.buildSearchQuery({
          searchTerm: params.searchTerm,
          contentTypes: params.contentTypes,
          locale: params.locale,
          limit: params.limit,
          skip: params.skip,
          includeScore: true,
          options: {
            maxDepth: params.maxDepth || 1
          }
        });
        variables = {
          limit: params.limit || 20,
          skip: params.skip || 0
        };
        operationName = 'SearchContent';
        break;
        
      case 'getContent':
        if (!params.contentId) {
          throw new ValidationError('Content ID is required for getContent operation');
        }
        query = await queryBuilder.buildGetContentQuery({
          id: params.contentId,
          locale: params.locale,
          includeAllFields: params.includeAllFields,
          options: {
            maxDepth: params.maxDepth || 2
          }
        });
        variables = {
          id: params.contentId
        };
        operationName = 'GetContent';
        break;
        
      case 'getByPath':
        if (!params.path) {
          throw new ValidationError('Path is required for getByPath operation');
        }
        query = await queryBuilder.buildGetContentByPathQuery({
          path: params.path,
          locale: params.locale,
          includeAllFields: params.includeAllFields,
          options: {
            maxDepth: params.maxDepth || 2
          }
        });
        variables = {
          path: params.path
        };
        operationName = 'GetContentByPath';
        break;
        
      case 'facetedSearch':
        if (!params.facets) {
          throw new ValidationError('Facets are required for facetedSearch operation');
        }
        query = await queryBuilder.buildFacetedSearchQuery({
          query: params.searchTerm,
          facets: params.facets,
          filters: params.filters,
          limit: params.limit,
          skip: params.skip,
          locale: params.locale
        });
        variables = {
          limit: params.limit || 20,
          skip: params.skip || 0
        };
        operationName = 'FacetedSearch';
        break;
        
      case 'related':
        if (!params.contentId) {
          throw new ValidationError('Content ID is required for related operation');
        }
        query = await queryBuilder.buildRelatedContentQuery({
          contentId: params.contentId,
          direction: params.direction || 'outgoing',
          limit: params.limit
        });
        variables = {
          contentId: params.contentId,
          limit: params.limit || 20
        };
        operationName = params.direction === 'incoming' ? 'GetIncomingRelations' : 'GetOutgoingRelations';
        break;
        
      default:
        throw new ValidationError(`Unknown operation: ${params.operation}`);
    }
    
    const result = await client.query(query, variables, {
      operationName
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

// Helper function to format field types
function formatFieldType(type: any): string {
  if (type.kind === 'NON_NULL') {
    return `${formatFieldType(type.ofType)}!`;
  }
  if (type.kind === 'LIST') {
    return `[${formatFieldType(type.ofType)}]`;
  }
  return type.name || 'Unknown';
}