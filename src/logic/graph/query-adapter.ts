import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { DynamicQueryBuilder, SearchOptions } from './dynamic-query-builder.js';
import { IntelligentQueryBuilder } from './intelligent-query-builder.js';
import { OptimizelyQueryBuilder, SearchQueryOptions } from './optimizely-query-builder.js';
import { SchemaAwareQueryBuilder, SchemaAwareSearchOptions } from './schema-aware-query-builder.js';
import { SimpleQueryBuilder } from './simple-query-builder.js';
import { GraphConfig } from '../../types/config.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Adapter that provides a unified interface for query building,
 * using the schema-aware query builder by default and falling back
 * to other builders for compatibility
 */
export class QueryAdapter {
  private simpleBuilder: SimpleQueryBuilder;
  private schemaAwareBuilder: SchemaAwareQueryBuilder | null = null;
  private optimizelyBuilder: OptimizelyQueryBuilder | null = null;
  private dynamicBuilder: DynamicQueryBuilder | null = null;
  private intelligentBuilder: IntelligentQueryBuilder | null = null;
  private useSimple = true;
  private useSchemaAware = false;
  private useOptimizely = false;
  private useDynamic = false;
  private logger = getLogger();
  private config: GraphConfig;

  constructor(private client: OptimizelyGraphClient, config: GraphConfig) {
    this.config = config;
    // Always create simple builder as it requires no initialization
    this.simpleBuilder = new SimpleQueryBuilder();
  }

  /**
   * Initialize the adapter
   */
  async initialize(): Promise<void> {
    // Simple builder is already initialized
    this.logger.info('Using simple query builder by default');
    
    // Optionally try to initialize more advanced builders if needed
    // But don't fail if they don't work - simple builder is always available
    if (this.config.useAdvancedBuilders === true) {
      try {
        // Try schema-aware builder
        this.schemaAwareBuilder = new SchemaAwareQueryBuilder(this.client, this.config);
        await this.schemaAwareBuilder.initialize();
        this.useSchemaAware = true;
        this.useSimple = false;
        this.logger.info('Schema-aware query builder initialized successfully');
      } catch (error) {
        this.logger.debug('Schema-aware builder not available, using simple builder', error);
      }
    }
  }

  /**
   * Get available content types
   */
  async getContentTypes(): Promise<string[]> {
    if (this.useSchemaAware && this.schemaAwareBuilder) {
      // Schema-aware builder has direct access to content types
      const schemaService = await (this.schemaAwareBuilder as any).ensureInitialized();
      return schemaService.getContentTypes();
    }
    
    // Simple builder doesn't need content types for basic operations
    return [];
  }

  /**
   * Build a search query
   */
  async buildSearchQuery(params: {
    searchTerm: string;
    contentTypes?: string[];
    locale?: string;
    limit?: number;
    skip?: number;
    includeScore?: boolean;
    options?: any;
  }): Promise<string> {
    if (this.useSimple) {
      return this.simpleBuilder.buildSearchQuery(
        params.searchTerm,
        params.limit || 20
      );
    }
    
    if (this.useSchemaAware && this.schemaAwareBuilder) {
      const searchOptions: SchemaAwareSearchOptions = {
        searchTerm: params.searchTerm,
        contentTypes: params.contentTypes,
        locale: params.locale,
        limit: params.limit || 20,
        skip: params.skip || 0,
        includeScore: params.includeScore,
        ...params.options
      };
      
      return this.schemaAwareBuilder.buildSearchQuery(searchOptions);
    }
    
    // Fallback to simple builder
    return this.simpleBuilder.buildSearchQuery(
      params.searchTerm,
      params.limit || 20
    );
  }

  /**
   * Build a query to get content by ID
   */
  async buildGetContentQuery(params: {
    id: string;
    locale?: string;
    includeAllFields?: boolean;
    options?: any;
  }): Promise<string> {
    if (this.useSimple) {
      return this.simpleBuilder.buildGetContentQuery(params.id);
    }
    
    if (this.useSchemaAware && this.schemaAwareBuilder) {
      return this.schemaAwareBuilder.buildGetByIdQuery(params.id, {
        ...params.options,
        includeMetadata: true,
        maxDepth: params.includeAllFields ? 2 : 1
      });
    }
    
    // Fallback to simple builder
    return this.simpleBuilder.buildGetContentQuery(params.id);
  }

  /**
   * Build a query to get content by path
   */
  async buildGetContentByPathQuery(params: {
    path: string;
    locale?: string;
    includeAllFields?: boolean;
    options?: any;
  }): Promise<string> {
    if (this.useSimple) {
      return this.simpleBuilder.buildGetContentByPathQuery(
        params.path,
        params.locale || 'en'
      );
    }
    
    if (this.useSchemaAware && this.schemaAwareBuilder) {
      return this.schemaAwareBuilder.buildGetByPathQuery(params.path, params.locale, {
        ...params.options,
        includeMetadata: true,
        maxDepth: params.includeAllFields ? 2 : 1
      });
    }
    
    // Fallback to simple builder
    return this.simpleBuilder.buildGetContentByPathQuery(
      params.path,
      params.locale || 'en'
    );
  }

  /**
   * Build a list query
   */
  async buildListQuery(params: {
    contentTypes?: string[];
    locale?: string;
    limit?: number;
    skip?: number;
    orderBy?: Record<string, 'ASC' | 'DESC'>;
    filters?: Record<string, any>;
    options?: any;
  }): Promise<string> {
    if (this.useOptimizely && this.optimizelyBuilder) {
      // Use search query with empty search term for listing
      return this.optimizelyBuilder.buildSearchQuery({
        searchTerm: '',
        contentTypes: params.contentTypes,
        locale: params.locale,
        limit: params.limit || 20,
        skip: params.skip || 0,
        filters: params.filters,
        ...params.options
      });
    } else if (this.useDynamic && this.dynamicBuilder) {
      return this.dynamicBuilder.buildListQuery(params);
    } else if (this.intelligentBuilder) {
      // Adapt to faceted search query for compatibility
      return this.intelligentBuilder.buildFacetedSearchQuery({
        facets: {},
        filters: params.filters,
        limit: params.limit,
        skip: params.skip,
        locale: params.locale
      });
    }
    
    throw new Error('No query builder available');
  }

  /**
   * Execute a query with the client
   */
  async executeQuery<T>(query: string, variables?: Record<string, any>): Promise<T> {
    return this.client.query<T>(query, variables);
  }

  /**
   * Get the current query builder mode
   */
  getMode(): 'simple' | 'schema-aware' | 'optimizely' | 'dynamic' | 'intelligent' {
    if (this.useSimple) return 'simple';
    if (this.useSchemaAware) return 'schema-aware';
    if (this.useOptimizely) return 'optimizely';
    return this.useDynamic ? 'dynamic' : 'intelligent';
  }
  
  /**
   * Get variable generators for queries
   */
  getVariableGenerators() {
    return {
      search: (searchTerm: string, limit: number = 20) => 
        this.simpleBuilder.getSearchVariables(searchTerm, limit),
      content: (id: string) => 
        this.simpleBuilder.getContentVariables(id),
      path: (path: string, locale: string = 'en') => 
        this.simpleBuilder.getPathVariables(path, locale)
    };
  }
}

/**
 * Create a query adapter instance
 */
export async function createQueryAdapter(config: GraphConfig): Promise<QueryAdapter> {
  const client = new OptimizelyGraphClient(config);
  const adapter = new QueryAdapter(client, config);
  await adapter.initialize();
  return adapter;
}