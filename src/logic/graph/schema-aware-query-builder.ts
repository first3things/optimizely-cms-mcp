import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { SchemaDiscoveryService, getSchemaDiscoveryService } from '../../services/schema-discovery.js';
import { GraphConfig } from '../../types/config.js';
import { getLogger } from '../../utils/logger.js';
import { getQuerySyntaxError } from '../../utils/graphql-validator.js';

export interface SchemaAwareQueryOptions {
  includeMetadata?: boolean;
  maxDepth?: number;
  includeFields?: string[];
  excludeFields?: string[];
}

export interface SchemaAwareSearchOptions extends SchemaAwareQueryOptions {
  searchTerm: string;
  contentTypes?: string[];
  locale?: string;
  limit?: number;
  skip?: number;
  includeScore?: boolean;
  filters?: Record<string, any>;
}

/**
 * Schema-aware query builder that validates queries before execution
 */
export class SchemaAwareQueryBuilder {
  private logger = getLogger();
  private schemaService: SchemaDiscoveryService | null = null;
  
  constructor(
    private client: OptimizelyGraphClient,
    private config: GraphConfig
  ) {}

  /**
   * Initialize the query builder with schema discovery
   */
  async initialize(): Promise<void> {
    this.logger.debug('Initializing schema-aware query builder...');
    this.schemaService = await getSchemaDiscoveryService(this.config);
    this.logger.debug('Schema-aware query builder initialized');
  }

  /**
   * Ensure the service is initialized
   */
  private async ensureInitialized(): Promise<SchemaDiscoveryService> {
    if (!this.schemaService) {
      await this.initialize();
    }
    if (!this.schemaService) {
      throw new Error('Failed to initialize schema service');
    }
    return this.schemaService;
  }

  /**
   * Build and validate a search query
   */
  async buildSearchQuery(options: SchemaAwareSearchOptions): Promise<string> {
    const schemaService = await this.ensureInitialized();
    
    // Get schema information
    const schemaInfo = await schemaService.getSchemaInfo();
    const metadataFields = Array.from(schemaInfo.metadataFields);
    
    // Build where clause
    const whereClause = await this.buildSearchWhereClause(options, schemaService);
    const orderByClause = options.includeScore ? 'orderBy: { _ranking: RELEVANCE }' : '';
    
    // Build the query
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
              ${this.buildMetadataFields(metadataFields)}
            }
            ${options.includeScore ? '_ranking' : ''}
            ${await this.buildDynamicFields(options, schemaService)}
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
    
    // Validate the query
    await this.validateQuery(query, schemaService);
    
    return this.cleanQuery(query);
  }

  /**
   * Build a query to get content by ID
   */
  async buildGetByIdQuery(id: string, options?: SchemaAwareQueryOptions): Promise<string> {
    const schemaService = await this.ensureInitialized();
    
    // Get schema information
    const schemaInfo = await schemaService.getSchemaInfo();
    const metadataFields = Array.from(schemaInfo.metadataFields);
    
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
              ${this.buildMetadataFields(metadataFields)}
            }
            ${await this.buildDynamicFields(options, schemaService)}
          }
        }
      }
    `;
    
    // Validate the query
    await this.validateQuery(query, schemaService);
    
    return this.cleanQuery(query);
  }

  /**
   * Build a query to get content by path
   */
  async buildGetByPathQuery(path: string, locale?: string, options?: SchemaAwareQueryOptions): Promise<string> {
    const schemaService = await this.ensureInitialized();
    
    // Get schema information
    const schemaInfo = await schemaService.getSchemaInfo();
    const metadataFields = Array.from(schemaInfo.metadataFields);
    
    // Check if url field exists in metadata
    const hasUrlField = await this.checkMetadataField('url', schemaService);
    
    if (!hasUrlField) {
      throw new Error('URL field not found in metadata. Content by path queries may not be supported.');
    }
    
    const whereConditions: string[] = [];
    
    // Use hierarchical if available, otherwise try path
    if (metadataFields.includes('url')) {
      whereConditions.push(`url: { hierarchical: { eq: "${path}" } }`);
    }
    
    if (locale && metadataFields.includes('locale')) {
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
              ${this.buildMetadataFields(metadataFields)}
            }
            ${await this.buildDynamicFields(options, schemaService)}
          }
        }
      }
    `;
    
    // Validate the query
    await this.validateQuery(query, schemaService);
    
    return this.cleanQuery(query);
  }

  /**
   * Build where clause for search queries
   */
  private async buildSearchWhereClause(
    options: SchemaAwareSearchOptions,
    schemaService: SchemaDiscoveryService
  ): Promise<string> {
    const conditions: string[] = [];
    const schemaInfo = await schemaService.getSchemaInfo();
    const metadataFields = Array.from(schemaInfo.metadataFields);
    
    if (options.searchTerm) {
      const searchConditions: string[] = [];
      
      // Always include full-text search
      searchConditions.push(`{ _fulltext: { match: "${options.searchTerm}" } }`);
      
      // Add metadata field searches if they exist
      if (metadataFields.includes('displayName')) {
        searchConditions.push(`{ _metadata: { displayName: { match: "${options.searchTerm}" } } }`);
      }
      
      if (metadataFields.includes('name')) {
        searchConditions.push(`{ _metadata: { name: { match: "${options.searchTerm}" } } }`);
      }
      
      conditions.push(`_or: [${searchConditions.join(', ')}]`);
    }
    
    // Handle content type filtering
    if (options.contentTypes && options.contentTypes.length > 0) {
      if (metadataFields.includes('types')) {
        const typeCondition = `_metadata: { types: { in: [${options.contentTypes.map(t => `"${t}"`).join(', ')}] } }`;
        
        if (conditions.length > 0) {
          // Wrap existing conditions with type condition
          const existingConditions = conditions.join(', ');
          conditions.length = 0;
          conditions.push(`_and: [{ ${existingConditions} }, { ${typeCondition} }]`);
        } else {
          conditions.push(typeCondition);
        }
      }
    }
    
    // Handle locale filter
    if (options.locale && metadataFields.includes('locale')) {
      const localeCondition = `_metadata: { locale: { eq: "${options.locale}" } }`;
      
      if (conditions.length > 0) {
        // Add to existing conditions
        const existingConditions = conditions.join(', ');
        conditions.length = 0;
        conditions.push(`_and: [{ ${existingConditions} }, { ${localeCondition} }]`);
      } else {
        conditions.push(localeCondition);
      }
    }
    
    return conditions.length > 0 ? `{ ${conditions.join(', ')} }` : '{}';
  }

  /**
   * Build metadata fields selection
   */
  private buildMetadataFields(availableFields: string[]): string {
    const commonFields = ['key', 'locale', 'displayName', 'types', 'published', 'created', 'lastModified', 'status'];
    const urlFields = ['url { base hierarchical }'];
    
    const fields = commonFields.filter(field => availableFields.includes(field));
    
    if (availableFields.includes('url')) {
      fields.push(...urlFields);
    }
    
    return fields.join('\n              ');
  }

  /**
   * Build dynamic fields based on content types and options
   */
  private async buildDynamicFields(
    options: SchemaAwareQueryOptions | undefined,
    schemaService: SchemaDiscoveryService
  ): Promise<string> {
    // Get common fields across all content types
    const commonFields = await schemaService.getCommonFields();
    
    if (options?.includeFields) {
      // Only include specified fields if they exist
      const validFields = options.includeFields.filter(field => 
        commonFields.includes(field) || field.startsWith('...')
      );
      return validFields.join('\n            ');
    }
    
    // Return a basic fragment for content interface
    return `
            ... on _IContent {
              _link {
                name
                url
              }
            }`;
  }

  /**
   * Check if a metadata field exists
   */
  private async checkMetadataField(
    fieldName: string,
    schemaService: SchemaDiscoveryService
  ): Promise<boolean> {
    return schemaService.isMetadataField(fieldName);
  }

  /**
   * Validate a query against the schema
   */
  private async validateQuery(query: string, schemaService: SchemaDiscoveryService): Promise<void> {
    // First check syntax
    const syntaxError = getQuerySyntaxError(query);
    if (syntaxError) {
      this.logger.error('GraphQL syntax error:', syntaxError);
      this.logger.debug('Query:', query);
      throw new Error(`GraphQL syntax error: ${syntaxError}`);
    }
    
    // Then validate against schema
    const validation = await schemaService.validateQuery(query);
    if (!validation.valid && validation.errors) {
      this.logger.error('GraphQL validation errors:', validation.errors);
      this.logger.debug('Query:', query);
      throw new Error(`GraphQL validation errors: ${validation.errors.join(', ')}`);
    }
  }

  /**
   * Clean up the generated query
   */
  private cleanQuery(query: string): string {
    return query
      .split('\n')
      .map(line => line.trimEnd())
      .filter(line => line.length > 0)
      .join('\n')
      .replace(/\n\s*\n/g, '\n'); // Remove empty lines
  }

  /**
   * Build an autocomplete query
   */
  async buildAutocompleteQuery(field: string, term: string, limit: number = 10): Promise<string> {
    const schemaService = await this.ensureInitialized();
    const schemaInfo = await schemaService.getSchemaInfo();
    const metadataFields = Array.from(schemaInfo.metadataFields);
    
    // Validate that the field exists
    const searchableFields = await schemaService.getSearchableFields();
    if (!searchableFields.includes(field) && !metadataFields.includes(field)) {
      this.logger.warn(`Field ${field} may not be searchable`);
    }
    
    const query = `
      query Autocomplete {
        _Content(
          where: { 
            _or: [
              { ${field}: { match: "${term}" } }
              ${metadataFields.includes('displayName') ? `{ _metadata: { displayName: { match: "${term}" } } }` : ''}
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
    
    // Validate the query
    await this.validateQuery(query, schemaService);
    
    return this.cleanQuery(query);
  }
}

/**
 * Factory function to create a schema-aware query builder
 */
export async function createSchemaAwareQueryBuilder(config: GraphConfig): Promise<SchemaAwareQueryBuilder> {
  const client = new OptimizelyGraphClient(config);
  const builder = new SchemaAwareQueryBuilder(client, config);
  await builder.initialize();
  return builder;
}