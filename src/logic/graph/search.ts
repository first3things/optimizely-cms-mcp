import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { GraphConfig } from '../../types/config.js';
import { handleError } from '../../utils/errors.js';
import { createCacheKey } from '../../utils/cache.js';
import { validateInput } from '../../utils/validation.js';
import {
  buildSearchQuery,
  buildGetContentQuery,
  buildGetChildrenQuery,
  buildGetAncestorsQuery,
  buildFacetedSearchQuery,
  SearchParamsSchema,
  GetContentParamsSchema,
  AutocompleteParamsSchema
} from './query-builder.js';

export async function executeGraphSearch(
  config: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(SearchParamsSchema, params);
    const client = new OptimizelyGraphClient(config);
    
    const query = buildSearchQuery({
      searchTerm: validatedParams.query,
      types: validatedParams.types,
      locale: validatedParams.locale,
      limit: validatedParams.limit,
      skip: validatedParams.skip,
      orderBy: validatedParams.orderBy ? {
        field: validatedParams.orderBy.field,
        direction: validatedParams.orderBy.direction || 'asc'
      } : undefined,
      includeScore: true
    });

    const variables = {
      limit: validatedParams.limit,
      skip: validatedParams.skip
    };

    const cacheKey = createCacheKey('graph:search', validatedParams);
    
    const result = await client.query(query, variables, {
      cacheKey,
      cacheTtl: 300, // 5 minutes
      operationName: 'SearchContent'
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

export async function executeGraphGetContent(
  config: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(GetContentParamsSchema, params);
    const client = new OptimizelyGraphClient(config);
    
    const query = buildGetContentQuery({
      id: validatedParams.id,
      locale: validatedParams.locale,
      fields: validatedParams.fields,
      includeRelated: validatedParams.includeRelated
    });

    const variables = {
      id: validatedParams.id,
      locale: validatedParams.locale
    };

    const cacheKey = createCacheKey('graph:content', validatedParams);
    
    const result = await client.query(query, variables, {
      cacheKey,
      cacheTtl: 300,
      operationName: 'GetContent'
    });

    // Extract the first item if found
    const content = (result as any).content?.items?.[0];
    
    if (!content) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Content not found', id: validatedParams.id }, null, 2)
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

export async function executeGraphAutocomplete(
  config: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(AutocompleteParamsSchema, params);
    const client = new OptimizelyGraphClient(config);
    
    // Build autocomplete query
    const query = `
      query Autocomplete($term: String!, $field: String!, $limit: Int) {
        autocomplete: _Content(
          where: { ${validatedParams.field}: { startsWith: $term } }
          limit: $limit
          orderBy: { ${validatedParams.field}: ASC }
        ) {
          items {
            _metadata {
              key
              displayName
              types
            }
            ... on _IContent {
              _metadata {
                displayName
              }
              ${validatedParams.field}
            }
          }
          suggestions: facets {
            ${validatedParams.field}(limit: $limit) {
              name
              count
            }
          }
        }
      }
    `;

    const variables = {
      term: validatedParams.query,
      field: validatedParams.field,
      limit: validatedParams.limit
    };

    const result = await client.query(query, variables, {
      operationName: 'Autocomplete'
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

export async function executeGraphGetChildren(
  config: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const { parentId, contentTypes, limit = 50, skip = 0, orderBy } = params;
    
    if (!parentId) {
      throw new Error('parentId is required');
    }

    const client = new OptimizelyGraphClient(config);
    
    const query = buildGetChildrenQuery({
      parentId,
      contentTypes,
      limit,
      skip,
      orderBy
    });

    const variables = {
      limit,
      skip
    };

    const cacheKey = createCacheKey('graph:children', params);
    
    const result = await client.query(query, variables, {
      cacheKey,
      cacheTtl: 300,
      operationName: 'GetChildren'
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

export async function executeGraphGetAncestors(
  config: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const { contentId, levels } = params;
    
    if (!contentId) {
      throw new Error('contentId is required');
    }

    const client = new OptimizelyGraphClient(config);
    const query = buildGetAncestorsQuery(contentId, levels);
    
    const cacheKey = createCacheKey('graph:ancestors', params);
    
    const result = await client.query(query, {}, {
      cacheKey,
      cacheTtl: 600, // 10 minutes
      operationName: 'GetAncestors'
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

export async function executeGraphFacetedSearch(
  config: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const { query, facets, filters, limit = 20, skip = 0, locale } = params;
    
    if (!facets || Object.keys(facets).length === 0) {
      throw new Error('At least one facet configuration is required');
    }

    const client = new OptimizelyGraphClient(config);
    
    const graphQuery = buildFacetedSearchQuery({
      query,
      facets,
      filters,
      limit,
      skip,
      locale
    });

    const variables = {
      limit,
      skip
    };

    const result = await client.query(graphQuery, variables, {
      operationName: 'FacetedSearch'
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