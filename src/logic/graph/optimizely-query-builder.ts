import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { getLogger } from '../../utils/logger.js';
import { GraphConfig } from '../../types/config.js';

export interface QueryOptions {
  includeMetadata?: boolean;
  maxDepth?: number;
  includeFields?: string[];
  excludeFields?: string[];
}

export interface SearchQueryOptions extends QueryOptions {
  searchTerm: string;
  contentTypes?: string[];
  locale?: string;
  limit?: number;
  skip?: number;
  includeScore?: boolean;
  filters?: Record<string, any>;
}

/**
 * Query builder that generates correct Optimizely Graph queries
 */
export class OptimizelyQueryBuilder {
  private logger = getLogger();
  
  constructor(private client: OptimizelyGraphClient) {}

  /**
   * Build a search query using correct Optimizely Graph syntax
   */
  async buildSearchQuery(options: SearchQueryOptions): Promise<string> {
    const whereClause = this.buildSearchWhereClause(options);
    const orderByClause = options.includeScore ? 'orderBy: { _ranking: RELEVANCE }' : '';
    
    const query = `
      query SearchContent($limit: Int!, $skip: Int!) {
        _Content(
          where: ${whereClause}
          limit: $limit
          skip: $skip
          ${orderByClause}
        ) {
          items {
            __typename
            _metadata {
              key
              locale
              displayName
              types
              url {
                base
                hierarchical
              }
              published
              created
              lastModified
              status
            }${options.includeScore ? '\n            _ranking' : ''}
            ${await this.buildDynamicFields(options)}
          }
          total
          facets {
            _metadata {
              types(limit: 10) {
                name
                count
              }
              locale(limit: 10) {
                name
                count
              }
            }
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Build a query to get content by ID
   */
  async buildGetByIdQuery(id: string, options?: QueryOptions): Promise<string> {
    const whereClause = `{
      _metadata: { 
        key: { eq: "${id}" }
      }
    }`;
    
    const query = `
      query GetContentById {
        _Content(
          where: ${whereClause}
          limit: 1
        ) {
          items {
            __typename
            _metadata {
              key
              locale
              displayName
              types
              url {
                base
                hierarchical
              }
              published
              created
              lastModified
              status
            }
            ${await this.buildDynamicFields(options)}
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Build a query to get content by path
   */
  async buildGetByPathQuery(path: string, locale?: string, options?: QueryOptions): Promise<string> {
    const whereConditions = [`url: { hierarchical: { eq: "${path}" } }`];
    
    if (locale) {
      whereConditions.push(`locale: { eq: "${locale}" }`);
    }
    
    const whereClause = `{
      _metadata: { 
        ${whereConditions.join(', ')}
      }
    }`;
    
    const query = `
      query GetContentByPath {
        _Content(
          where: ${whereClause}
          limit: 1
        ) {
          items {
            __typename
            _metadata {
              key
              locale
              displayName
              types
              url {
                base
                hierarchical
              }
              published
              created
              lastModified
              status
            }
            ${await this.buildDynamicFields(options)}
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Build where clause for search queries
   */
  private buildSearchWhereClause(options: SearchQueryOptions): string {
    const conditions: string[] = [];
    let hasSearchConditions = false;
    
    if (options.searchTerm) {
      const searchConditions: string[] = [];
      
      // Use match operator for full-text search
      searchConditions.push(`{ _fulltext: { match: "${options.searchTerm}" } }`);
      
      // Add metadata field searches
      searchConditions.push(`{ _metadata: { displayName: { match: "${options.searchTerm}" } } }`);
      searchConditions.push(`{ _metadata: { name: { match: "${options.searchTerm}" } } }`);
      
      conditions.push(`_or: [${searchConditions.join(', ')}]`);
      hasSearchConditions = true;
    }
    
    // Handle content type filtering
    if (options.contentTypes && options.contentTypes.length > 0) {
      const typeConditions: string[] = [];
      
      // Check if types is an array field
      typeConditions.push(
        `_metadata: { types: { in: [${options.contentTypes.map(t => `"${t}"`).join(', ')}] } }`
      );
      
      if (!hasSearchConditions) {
        conditions.push(...typeConditions);
      } else {
        // Combine with search conditions
        const searchCondition = conditions[0];
        conditions.length = 0; // Clear array
        conditions.push(`_and: [{ ${searchCondition} }, { ${typeConditions.join(', ')} }]`);
      }
    }
    
    // Handle locale filter
    if (options.locale) {
      conditions.push(`_metadata: { locale: { eq: "${options.locale}" } }`);
    }
    
    // Handle custom filters
    if (options.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        if (Array.isArray(value)) {
          conditions.push(`${key}: { in: [${value.map(v => JSON.stringify(v)).join(', ')}] }`);
        } else if (typeof value === 'object' && value !== null) {
          const ops = Object.entries(value)
            .map(([op, val]) => `${op}: ${JSON.stringify(val)}`)
            .join(', ');
          conditions.push(`${key}: { ${ops} }`);
        } else {
          conditions.push(`${key}: { eq: ${JSON.stringify(value)} }`);
        }
      }
    }
    
    return conditions.length > 0 ? `{ ${conditions.join(', ')} }` : '{}';
  }

  /**
   * Build dynamic fields based on content types
   */
  private async buildDynamicFields(options?: QueryOptions): Promise<string> {
    // For now, return common fields
    // In a full implementation, this would introspect the schema
    const commonFields = `
      ... on _IContent {
        _link {
          name
          url
        }
      }
    `;
    
    return commonFields;
  }

  /**
   * Clean up the generated query
   */
  private cleanQuery(query: string): string {
    return query
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  }

  /**
   * Build an autocomplete query
   */
  async buildAutocompleteQuery(field: string, term: string, limit: number = 10): Promise<string> {
    const query = `
      query Autocomplete {
        _Content(
          where: { 
            _or: [
              { ${field}: { match: "${term}" } }
              { _metadata: { displayName: { match: "${term}" } } }
            ]
          }
          limit: ${limit}
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
            ${field}(limit: ${limit}) {
              name
              count
            }
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Build a faceted search query
   */
  async buildFacetedSearchQuery(params: {
    query?: string;
    facets: Record<string, { field: string; limit?: number }>;
    filters?: Record<string, any>;
    limit?: number;
    skip?: number;
    locale?: string;
  }): Promise<string> {
    const searchOptions: SearchQueryOptions = {
      searchTerm: params.query || '',
      locale: params.locale,
      filters: params.filters,
      limit: params.limit,
      skip: params.skip
    };
    
    const whereClause = this.buildSearchWhereClause(searchOptions);
    
    // Build facet queries
    const facetQueries = Object.entries(params.facets)
      .map(([name, config]) => `
        ${name}: ${config.field}(limit: ${config.limit || 10}) {
          name
          count
        }
      `).join('\n');
    
    const query = `
      query FacetedSearch($limit: Int!, $skip: Int!) {
        _Content(
          where: ${whereClause}
          limit: $limit
          skip: $skip
          orderBy: { _ranking: RELEVANCE }
        ) {
          items {
            __typename
            _metadata {
              key
              locale
              displayName
              types
            }
          }
          total
          facets {
            ${facetQueries}
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Build a query to check schema capabilities
   */
  async buildSchemaCheckQuery(): Promise<string> {
    const query = `
      query SchemaCheck {
        __type(name: "StringFilterInput") {
          name
          inputFields {
            name
            type {
              name
            }
          }
        }
        metadataType: __type(name: "_Metadata") {
          name
          fields {
            name
            type {
              name
              kind
            }
          }
        }
        contentWhereType: __type(name: "_ContentWhereInput") {
          name
          inputFields {
            name
            type {
              name
            }
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }
}

/**
 * Factory function to create an Optimizely query builder
 */
export async function createOptimizelyQueryBuilder(config: GraphConfig): Promise<OptimizelyQueryBuilder> {
  const client = new OptimizelyGraphClient(config);
  return new OptimizelyQueryBuilder(client);
}