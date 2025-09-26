import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { GraphConfig } from '../../types/config.js';
import { handleError } from '../../utils/errors.js';
import { createCacheKey } from '../../utils/cache.js';
import { validateInput } from '../../utils/validation.js';
import { createQueryAdapter } from './query-adapter.js';
import { getLogger } from '../../utils/logger.js';
import { createIntelligentQueryBuilder } from './intelligent-query-builder.js';
import {
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
    const logger = getLogger();
    const queryAdapter = await createQueryAdapter(config);
    
    logger.debug(`Using ${queryAdapter.getMode()} query builder for search`);
    
    const query = await queryAdapter.buildSearchQuery({
      searchTerm: validatedParams.query,
      contentTypes: validatedParams.types,
      locale: validatedParams.locale,
      limit: validatedParams.limit,
      skip: validatedParams.skip,
      includeScore: true,
      options: {
        maxDepth: 1,
        includeMetadata: true
      }
    });

    const variableGenerators = queryAdapter.getVariableGenerators();
    const variables = variableGenerators.search(
      validatedParams.query,
      validatedParams.limit
    );

    const cacheKey = createCacheKey('graph:search', validatedParams);
    
    const result = await queryAdapter.executeQuery(query, variables);

    // Handle different response structures
    const searchResult = (result as any).content || 
                        (result as any)._Content || 
                        (result as any).Content || 
                        result;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(searchResult, null, 2)
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
    const logger = getLogger();
    const queryAdapter = await createQueryAdapter(config);
    
    logger.debug(`Using ${queryAdapter.getMode()} query builder for get content`);
    
    // Extract the key from IDs that include locale and status suffixes
    // e.g., "fe8be9de-7160-48a8-a16f-5fcdd25b04f9_en_Published" -> "fe8be9de-7160-48a8-a16f-5fcdd25b04f9"
    let contentKey = validatedParams.id;
    if (contentKey.includes('_')) {
      // Extract just the GUID part before the first underscore
      contentKey = contentKey.split('_')[0];
    }
    // Keep the dashes - the key in _metadata includes them
    
    const query = await queryAdapter.buildGetContentQuery({
      id: contentKey,
      locale: validatedParams.locale,
      includeAllFields: validatedParams.includeRelated || !validatedParams.fields,
      options: {
        includeFields: validatedParams.fields,
        maxDepth: 2
      }
    });

    const variableGenerators = queryAdapter.getVariableGenerators();
    const variables = variableGenerators.content(contentKey);

    const cacheKey = createCacheKey('graph:content', validatedParams);
    
    const result = await queryAdapter.executeQuery(query, variables);

    // Extract the first item if found - handle different response structures
    const content = (result as any).content?.items?.[0] ||
                   (result as any)._Content?.items?.[0] ||
                   (result as any).Content?.items?.[0];
    
    if (!content) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ 
            error: 'Content not found', 
            id: validatedParams.id,
            searchedKey: contentKey,
            hint: 'Make sure the ID is correct. The key should be a GUID like "fe8be9de-7160-48a8-a16f-5fcdd25b04f9"'
          }, null, 2)
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
    const queryAdapter = await createQueryAdapter(config);
    const logger = getLogger();
    
    logger.debug(`Using ${queryAdapter.getMode()} query builder for autocomplete`);
    
    // Build autocomplete query using match operator
    const query = `
      query Autocomplete($term: String!, $limit: Int!) {
        _Content(
          where: { 
            _or: [
              { _metadata: { displayName: { match: $term } } },
              { _metadata: { name: { match: $term } } },
              { _fulltext: { match: $term } }
            ]
          }
          limit: $limit
          orderBy: { _ranking: RELEVANCE }
        ) {
          items {
            __typename
            _metadata {
              key
              displayName
              types
            }
          }
          facets {
            _metadata {
              displayName(limit: $limit) {
                name
                count
              }
            }
          }
        }
      }
    `;

    const variables = {
      term: validatedParams.query,
      limit: validatedParams.limit
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
    const queryBuilder = await createIntelligentQueryBuilder(config);
    
    // For now, we'll use a simpler search approach since parent/child relationships
    // might not be directly supported in all Optimizely Graph instances
    const query = await queryBuilder.buildSearchQuery({
      searchTerm: '',
      contentTypes: contentTypes,
      limit: limit,
      skip: skip,
      options: {
        maxDepth: 1
      }
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
    const queryBuilder = await createIntelligentQueryBuilder(config);
    
    // For now, just get the content itself as ancestors might not be supported
    const query = await queryBuilder.buildGetContentQuery({
      id: contentId,
      includeAllFields: false
    });
    
    const cacheKey = createCacheKey('graph:ancestors', params);
    
    const result = await client.query(query, { id: contentId }, {
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
    const queryBuilder = await createIntelligentQueryBuilder(config);
    
    const graphQuery = await queryBuilder.buildFacetedSearchQuery({
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