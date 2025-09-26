import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { SchemaIntrospector, FieldInfo, ContentTypeInfo } from './schema-introspector.js';
import { getLogger } from '../../utils/logger.js';
import { GraphConfig } from '../../types/config.js';
import { ContentFieldMapper } from '../../utils/content-field-mapper.js';

export interface DynamicQueryOptions {
  includeMetadata?: boolean;
  maxDepth?: number;
  includeFields?: string[];
  excludeFields?: string[];
  contentTypes?: string[];
}

export interface SearchOptions extends DynamicQueryOptions {
  searchTerm: string;
  locale?: string;
  limit?: number;
  skip?: number;
  includeScore?: boolean;
  filters?: Record<string, any>;
}

/**
 * Dynamic query builder that adapts to the actual GraphQL schema
 */
export class DynamicQueryBuilder {
  private introspector: SchemaIntrospector;
  private logger = getLogger();
  private contentQueryField: string | null = null;
  private metadataType: any = null;
  private initialized = false;
  private fieldMapper: ContentFieldMapper;

  constructor(private client: OptimizelyGraphClient) {
    this.introspector = new SchemaIntrospector(client);
    this.fieldMapper = new ContentFieldMapper(client);
  }

  /**
   * Initialize the query builder
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.logger.debug('Initializing dynamic query builder');
    await this.introspector.initialize();

    // Find the content query field
    this.contentQueryField = await this.introspector.findContentQueryField();
    if (!this.contentQueryField) {
      throw new Error('Could not find content query field in GraphQL schema');
    }

    // Get metadata type structure
    this.metadataType = await this.introspector.getMetadataType();

    this.initialized = true;
    this.logger.info('Dynamic query builder initialized', {
      contentQueryField: this.contentQueryField,
      hasMetadataType: !!this.metadataType
    });
  }

  /**
   * Build a search query based on the actual schema
   */
  async buildSearchQuery(options: SearchOptions): Promise<string> {
    await this.initialize();

    // Get available content types
    const allContentTypes = await this.introspector.getContentTypes();
    let targetTypes = allContentTypes;

    if (options.contentTypes && options.contentTypes.length > 0) {
      targetTypes = allContentTypes.filter(ct => 
        options.contentTypes!.includes(ct.name)
      );
    }

    // Build where clause dynamically
    const whereClause = await this.buildDynamicWhereClause(options);
    
    // Build field selections
    const fieldSelections = await this.buildFieldSelections(targetTypes, options);

    // Construct the query
    const query = `
      query DynamicSearch($limit: Int, $skip: Int) {
        ${this.contentQueryField}(
          where: ${whereClause}
          limit: $limit
          skip: $skip
          ${options.includeScore ? 'orderBy: { _score: DESC }' : ''}
        ) {
          items {
            __typename
            ${fieldSelections}
          }
          total
          ${await this.buildFacetsQuery(targetTypes)}
        }
      }
    `;

    return this.cleanQuery(query);
  }

  /**
   * Build a query to get content by ID
   */
  async buildGetByIdQuery(id: string, options?: DynamicQueryOptions): Promise<string> {
    await this.initialize();

    const whereClause = await this.buildIdWhereClause(id);
    const contentTypes = await this.introspector.getContentTypes();
    const fieldSelections = await this.buildFieldSelections(contentTypes, options);

    const query = `
      query GetContentById($id: String!) {
        ${this.contentQueryField}(
          where: ${whereClause}
          limit: 1
        ) {
          items {
            __typename
            ${fieldSelections}
          }
        }
      }
    `;

    return this.cleanQuery(query);
  }

  /**
   * Build a query to get content by path/URL
   */
  async buildGetByPathQuery(path: string, options?: DynamicQueryOptions): Promise<string> {
    await this.initialize();

    const whereClause = await this.buildPathWhereClause(path, options?.locale);
    const contentTypes = await this.introspector.getContentTypes();
    const fieldSelections = await this.buildFieldSelections(contentTypes, options);

    const query = `
      query GetContentByPath($path: String!) {
        ${this.contentQueryField}(
          where: ${whereClause}
          limit: 1
        ) {
          items {
            __typename
            ${fieldSelections}
          }
        }
      }
    `;

    return this.cleanQuery(query);
  }

  /**
   * Build a query to list content with filters
   */
  async buildListQuery(options: {
    contentTypes?: string[];
    locale?: string;
    limit?: number;
    skip?: number;
    orderBy?: Record<string, 'ASC' | 'DESC'>;
    filters?: Record<string, any>;
  } & DynamicQueryOptions): Promise<string> {
    await this.initialize();

    const whereClause = await this.buildDynamicWhereClause({
      ...options,
      searchTerm: ''
    });

    const contentTypes = await this.getTargetContentTypes(options.contentTypes);
    const fieldSelections = await this.buildFieldSelections(contentTypes, options);

    const orderByClause = options.orderBy 
      ? `orderBy: ${this.buildOrderByClause(options.orderBy)}`
      : '';

    const query = `
      query ListContent($limit: Int, $skip: Int) {
        ${this.contentQueryField}(
          where: ${whereClause}
          limit: $limit
          skip: $skip
          ${orderByClause}
        ) {
          items {
            __typename
            ${fieldSelections}
          }
          total
        }
      }
    `;

    return this.cleanQuery(query);
  }

  /**
   * Build where clause based on discovered schema
   */
  private async buildDynamicWhereClause(options: SearchOptions): Promise<string> {
    const conditions: string[] = [];

    // Handle search term
    if (options.searchTerm) {
      const searchConditions = await this.buildSearchConditions(options.searchTerm);
      if (searchConditions.length > 0) {
        conditions.push(`_or: [${searchConditions.join(', ')}]`);
      }
    }

    // Handle content type filter
    if (options.contentTypes && options.contentTypes.length > 0) {
      // Find the correct way to filter by type
      const typeFilter = await this.buildTypeFilter(options.contentTypes);
      if (typeFilter) {
        conditions.push(typeFilter);
      }
    }

    // Handle locale filter
    if (options.locale) {
      const localeFilter = await this.buildLocaleFilter(options.locale);
      if (localeFilter) {
        conditions.push(localeFilter);
      }
    }

    // Handle custom filters
    if (options.filters) {
      const customFilters = this.buildCustomFilters(options.filters);
      conditions.push(...customFilters);
    }

    return conditions.length > 0 
      ? `{ ${conditions.join(', ')} }`
      : '{}';
  }

  /**
   * Build search conditions based on available searchable fields
   */
  private async buildSearchConditions(searchTerm: string): Promise<string[]> {
    const searchableFields = await this.introspector.getSearchableFields();
    const conditions: string[] = [];

    // Always try _fulltext if available
    conditions.push(`{ _fulltext: { contains: "${searchTerm}" } }`);

    // Add field-specific searches
    for (const field of searchableFields) {
      if (field.includes('.')) {
        // Nested field (e.g., _metadata.displayName)
        const [parent, child] = field.split('.');
        conditions.push(`{ ${parent}: { ${child}: { contains: "${searchTerm}" } } }`);
      } else {
        conditions.push(`{ ${field}: { contains: "${searchTerm}" } }`);
      }
    }

    return conditions;
  }

  /**
   * Build type filter based on schema
   */
  private async buildTypeFilter(contentTypes: string[]): Promise<string | null> {
    // Try different patterns based on what we find in the schema
    const whereType = await this.introspector.getWhereInputType(this.contentQueryField!);
    
    if (!whereType) return null;

    // Look for type filtering fields
    const possibleFields = ['_metadata.types', '_metadata.contentType', 'contentType', '__typename'];
    
    for (const fieldPath of possibleFields) {
      if (fieldPath.includes('.')) {
        const [parent, child] = fieldPath.split('.');
        const parentField = whereType.inputFields?.find(f => f.name === parent);
        if (parentField) {
          // This is a nested field, build nested filter
          return `${parent}: { ${child}: { in: [${contentTypes.map(t => `"${t}"`).join(', ')}] } }`;
        }
      } else {
        const field = whereType.inputFields?.find(f => f.name === fieldPath);
        if (field) {
          return `${fieldPath}: { in: [${contentTypes.map(t => `"${t}"`).join(', ')}] }`;
        }
      }
    }

    // If no specific type field found, we might need to use inline fragments
    return null;
  }

  /**
   * Build locale filter
   */
  private async buildLocaleFilter(locale: string): Promise<string | null> {
    // Common patterns for locale filtering
    const patterns = [
      `_metadata: { locale: { eq: "${locale}" } }`,
      `locale: { eq: "${locale}" }`,
      `language: { eq: "${locale}" }`
    ];

    // For now, return the most common pattern
    // In a production system, we'd verify this against the schema
    return patterns[0];
  }

  /**
   * Build field selections based on content types
   */
  private async buildFieldSelections(
    contentTypes: ContentTypeInfo[], 
    options?: DynamicQueryOptions
  ): Promise<string> {
    const selections: string[] = [];

    // Always include metadata if available
    if (options?.includeMetadata !== false && this.metadataType) {
      selections.push(await this.buildMetadataSelection());
    }

    // Build type-specific selections using inline fragments
    for (const contentType of contentTypes) {
      const typeSelection = await this.buildTypeSelection(contentType, options);
      if (typeSelection) {
        selections.push(`
          ... on ${contentType.name} {
            ${typeSelection}
          }`);
      }
    }

    return selections.join('\n');
  }

  /**
   * Build metadata field selection
   */
  private async buildMetadataSelection(): Promise<string> {
    if (!this.metadataType) return '';

    const metadataFields = this.metadataType.fields?.map((f: FieldInfo) => {
      if (f.name === 'url' && f.type === 'ContentUrl') {
        return `${f.name} {
              base
              hierarchical
            }`;
      }
      return f.name;
    }).join('\n            ') || '';

    return `_metadata {
            ${metadataFields}
          }`;
  }

  /**
   * Build field selection for a specific content type
   */
  private async buildTypeSelection(
    contentType: ContentTypeInfo,
    options?: DynamicQueryOptions
  ): Promise<string> {
    // Try to get actual field mappings first
    const fieldInfo = await this.fieldMapper.getFieldsForContentType(contentType.name);
    
    if (fieldInfo) {
      // Use discovered field mappings
      const selections: string[] = [];
      
      for (const [fieldName, mapping] of fieldInfo.fields) {
        // Skip system fields
        if (fieldName.startsWith('_') && fieldName !== '_metadata') continue;
        
        // Apply filters
        if (options?.includeFields && !options.includeFields.includes(fieldName)) continue;
        if (options?.excludeFields?.includes(fieldName)) continue;
        
        // Check if it's a simple type
        const simpleTypes = ['String', 'Int', 'Float', 'Boolean', 'ID', 'DateTime', 'Date', 'Url', 'Html'];
        if (simpleTypes.includes(mapping.type)) {
          selections.push(fieldName);
        }
      }
      
      // Always include the main content field if it exists
      const mainContentField = await this.fieldMapper.getMainContentField(contentType.name);
      if (mainContentField && !selections.includes(mainContentField)) {
        selections.push(mainContentField);
      }
      
      return selections.join('\n            ');
    }
    
    // Fall back to introspection-based selection
    let fields = contentType.fields;

    // Apply field filters
    if (options?.includeFields) {
      fields = fields.filter(f => options.includeFields!.includes(f.name));
    }

    if (options?.excludeFields) {
      fields = fields.filter(f => !options.excludeFields!.includes(f.name));
    }

    // Filter out complex fields for now (unless maxDepth allows)
    const maxDepth = options?.maxDepth || 1;
    const simpleFields = fields.filter(f => {
      // Always include scalars and enums
      const scalarTypes = ['String', 'Int', 'Float', 'Boolean', 'ID', 'DateTime', 'Date'];
      if (scalarTypes.includes(f.type)) return true;

      // Include objects if we have depth remaining
      if (maxDepth > 1 && !f.isList) return true;

      return false;
    });

    return simpleFields.map(f => f.name).join('\n            ');
  }

  /**
   * Build facets query
   */
  private async buildFacetsQuery(contentTypes: ContentTypeInfo[]): Promise<string> {
    // Build facets based on common fields
    return `facets {
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
          }`;
  }

  /**
   * Build where clause for ID search
   */
  private async buildIdWhereClause(id: string): Promise<string> {
    // Try multiple ID field patterns
    return `{
      _or: [
        { _metadata: { key: { eq: $id } } }
        { _metadata: { guid: { eq: $id } } }
        { id: { eq: $id } }
        { contentLink: { eq: $id } }
      ]
    }`;
  }

  /**
   * Build where clause for path search
   */
  private async buildPathWhereClause(path: string, locale?: string): Promise<string> {
    const conditions: string[] = [];

    // URL/path conditions
    conditions.push(`_metadata: { url: { hierarchical: { eq: $path } } }`);

    // Add locale if specified
    if (locale) {
      conditions.push(`_metadata: { locale: { eq: "${locale}" } }`);
    }

    return `{ ${conditions.join(', ')} }`;
  }

  /**
   * Build order by clause
   */
  private buildOrderByClause(orderBy: Record<string, 'ASC' | 'DESC'>): string {
    const clauses = Object.entries(orderBy)
      .map(([field, direction]) => `${field}: ${direction}`)
      .join(', ');
    return `{ ${clauses} }`;
  }

  /**
   * Build custom filters
   */
  private buildCustomFilters(filters: Record<string, any>): string[] {
    const conditions: string[] = [];

    for (const [key, value] of Object.entries(filters)) {
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

    return conditions;
  }

  /**
   * Get target content types
   */
  private async getTargetContentTypes(typeNames?: string[]): Promise<ContentTypeInfo[]> {
    const allTypes = await this.introspector.getContentTypes();
    
    if (!typeNames || typeNames.length === 0) {
      return allTypes;
    }

    return allTypes.filter(ct => typeNames.includes(ct.name));
  }

  /**
   * Clean up the generated query
   */
  private cleanQuery(query: string): string {
    // Remove extra whitespace and empty lines
    return query
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n          ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * Factory function to create a dynamic query builder
 */
export async function createDynamicQueryBuilder(config: GraphConfig): Promise<DynamicQueryBuilder> {
  const client = new OptimizelyGraphClient(config);
  const builder = new DynamicQueryBuilder(client);
  await builder.initialize();
  return builder;
}