import { 
  IntrospectionQuery, 
  IntrospectionType, 
  IntrospectionField, 
  IntrospectionInputValue,
  IntrospectionTypeRef,
  IntrospectionNamedTypeRef
} from 'graphql';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { GraphConfig } from '../../types/config.js';
import { getLogger } from '../../utils/logger.js';

export interface QueryBuilderOptions {
  includeMetadata?: boolean;
  maxDepth?: number;
  excludeFields?: string[];
  includeFields?: string[];
}

export interface FieldSelection {
  name: string;
  alias?: string;
  arguments?: Record<string, any>;
  subFields?: FieldSelection[];
}

export class IntelligentQueryBuilder {
  private schema: IntrospectionQuery | null = null;
  private typeMap: Map<string, IntrospectionType> = new Map();
  private logger = getLogger();
  
  constructor(private client: OptimizelyGraphClient) {}

  /**
   * Initialize the query builder by fetching the schema
   */
  async initialize(): Promise<void> {
    if (this.schema) return;
    
    this.logger.debug('Fetching GraphQL schema for intelligent query building');
    this.schema = await this.client.introspect();
    
    // Build type map for quick lookups
    this.schema.__schema.types.forEach(type => {
      this.typeMap.set(type.name, type);
    });
    
    this.logger.info('Schema loaded successfully', { 
      typeCount: this.schema.__schema.types.length 
    });
  }

  /**
   * Get available content types (excluding system types)
   */
  async getContentTypes(): Promise<string[]> {
    await this.initialize();
    
    const contentTypes: string[] = [];
    
    for (const type of this.schema!.__schema.types) {
      // Skip GraphQL internal types and interfaces
      if (type.name.startsWith('__') || 
          type.name.startsWith('_') ||
          type.kind !== 'OBJECT') {
        continue;
      }
      
      // Check if type implements _IContent interface
      const interfaces = (type as any).interfaces;
      if (interfaces?.some((i: any) => i.name === '_IContent')) {
        contentTypes.push(type.name);
      }
    }
    
    return contentTypes.sort();
  }

  /**
   * Get fields available for a specific type
   */
  async getFieldsForType(typeName: string): Promise<IntrospectionField[]> {
    await this.initialize();
    
    const type = this.typeMap.get(typeName);
    if (!type || type.kind !== 'OBJECT') {
      return [];
    }
    
    return (type as any).fields || [];
  }

  /**
   * Build a search query dynamically based on available fields
   */
  async buildSearchQuery(params: {
    searchTerm: string;
    contentTypes?: string[];
    locale?: string;
    limit?: number;
    skip?: number;
    includeScore?: boolean;
    options?: QueryBuilderOptions;
  }): Promise<string> {
    await this.initialize();
    
    const whereClause = await this.buildWhereClause({
      searchTerm: params.searchTerm,
      contentTypes: params.contentTypes,
      locale: params.locale
    });
    
    // Get common fields from _IContent interface
    const contentInterface = this.typeMap.get('_IContent');
    const commonFields = await this.getCommonContentFields();
    
    const query = `
      query SearchContent($limit: Int = ${params.limit || 20}, $skip: Int = ${params.skip || 0}) {
        content: _Content(
          where: ${whereClause}
          limit: $limit
          skip: $skip
        ) {
          items {
            ${commonFields}
            ${params.includeScore ? '_score' : ''}
            ${params.contentTypes ? await this.buildTypeSpecificFields(params.contentTypes, params.options) : ''}
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
    
    return query;
  }

  /**
   * Build a query to get content by ID
   */
  async buildGetContentQuery(params: {
    id: string;
    locale?: string;
    includeAllFields?: boolean;
    options?: QueryBuilderOptions;
  }): Promise<string> {
    await this.initialize();
    
    const commonFields = await this.getCommonContentFields();
    const whereClause = {
      _metadata: {
        key: { eq: params.id }
      }
    };
    
    if (params.locale) {
      (whereClause._metadata as any).locale = { eq: params.locale };
    }
    
    // Discover available fields dynamically
    const contentTypes = await this.discoverContentTypesForQuery();
    const typeSpecificFields = params.includeAllFields 
      ? await this.buildTypeSpecificFields(contentTypes, params.options)
      : '';
    
    const query = `
      query GetContent($id: String!) {
        content: _Content(
          where: ${JSON.stringify(whereClause).replace(/"(\w+)":/g, '$1:').replace(/"\$id"/g, '$id')}
          limit: 1
        ) {
          items {
            ${commonFields}
            ${typeSpecificFields}
          }
        }
      }
    `;
    
    return query;
  }

  /**
   * Build a query to get content by path
   */
  async buildGetContentByPathQuery(params: {
    path: string;
    locale?: string;
    includeAllFields?: boolean;
    options?: QueryBuilderOptions;
  }): Promise<string> {
    await this.initialize();
    
    const commonFields = await this.getCommonContentFields();
    
    // Build where clause for path search
    const whereClause = {
      _metadata: {
        url: { 
          hierarchical: { eq: params.path }
        }
      }
    };
    
    if (params.locale) {
      (whereClause._metadata as any).locale = { eq: params.locale };
    }
    
    // Discover available fields dynamically
    const contentTypes = await this.discoverContentTypesForQuery();
    const typeSpecificFields = params.includeAllFields 
      ? await this.buildTypeSpecificFields(contentTypes, params.options)
      : '';
    
    const query = `
      query GetContentByPath($path: String!) {
        content: _Content(
          where: ${JSON.stringify(whereClause).replace(/"(\w+)":/g, '$1:').replace(/"\$path"/g, '$path')}
          limit: 1
        ) {
          items {
            ${commonFields}
            ${typeSpecificFields}
          }
        }
      }
    `;
    
    return query;
  }

  /**
   * Build faceted search query
   */
  async buildFacetedSearchQuery(params: {
    query?: string;
    facets: Record<string, { field: string; limit?: number }>;
    filters?: Record<string, any>;
    limit?: number;
    skip?: number;
    locale?: string;
  }): Promise<string> {
    await this.initialize();
    
    const whereClause = await this.buildWhereClause({
      searchTerm: params.query,
      filters: params.filters,
      locale: params.locale
    });
    
    const commonFields = await this.getCommonContentFields();
    
    // Build facet queries
    const facetQueries = Object.entries(params.facets)
      .map(([name, config]) => `
        ${name}: ${config.field}(limit: ${config.limit || 10}) {
          name
          count
        }
      `).join('\n');
    
    const query = `
      query FacetedSearch($limit: Int = ${params.limit || 20}, $skip: Int = ${params.skip || 0}) {
        content: _Content(
          where: ${whereClause}
          limit: $limit
          skip: $skip
        ) {
          items {
            ${commonFields}
          }
          total
          facets {
            ${facetQueries}
          }
        }
      }
    `;
    
    return query;
  }

  /**
   * Get common fields from _IContent interface
   */
  private async getCommonContentFields(): Promise<string> {
    const metadataType = this.typeMap.get('ContentMetadata');
    const metadataFields = metadataType && metadataType.kind === 'OBJECT' 
      ? (metadataType as any).fields.map((f: IntrospectionField) => f.name).join('\n              ')
      : `key
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
              status`;
    
    return `
      _metadata {
        ${metadataFields}
      }`;
  }

  /**
   * Build where clause based on available fields
   */
  private async buildWhereClause(params: {
    searchTerm?: string;
    contentTypes?: string[];
    locale?: string;
    filters?: Record<string, any>;
  }): Promise<string> {
    const conditions: string[] = [];
    
    if (params.searchTerm) {
      // Discover searchable fields dynamically
      const searchableFields = await this.discoverSearchableFields();
      
      if (searchableFields.length > 0) {
        const searchConditions = searchableFields.map(field => 
          `{ ${field}: { contains: "${params.searchTerm}" } }`
        );
        
        conditions.push(`_or: [${searchConditions.join(', ')}]`);
      }
    }
    
    if (params.contentTypes && params.contentTypes.length > 0) {
      conditions.push(
        `_metadata: { types: { in: [${params.contentTypes.map(t => `"${t}"`).join(', ')}] } }`
      );
    }
    
    if (params.locale) {
      conditions.push(`_metadata: { locale: { eq: "${params.locale}" } }`);
    }
    
    if (params.filters) {
      Object.entries(params.filters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          conditions.push(`${key}: { in: [${value.map(v => JSON.stringify(v)).join(', ')}] }`);
        } else if (typeof value === 'object' && value !== null) {
          const filterStr = Object.entries(value)
            .map(([op, val]) => `${op}: ${JSON.stringify(val)}`)
            .join(', ');
          conditions.push(`${key}: { ${filterStr} }`);
        } else {
          conditions.push(`${key}: { eq: ${JSON.stringify(value)} }`);
        }
      });
    }
    
    return conditions.length > 0 ? `{ ${conditions.join(', ')} }` : '{}';
  }

  /**
   * Discover searchable fields from the schema
   */
  private async discoverSearchableFields(): Promise<string[]> {
    const searchableFields: Set<string> = new Set();
    
    // Always include metadata fields
    searchableFields.add('_metadata.displayName');
    searchableFields.add('_metadata.name');
    
    // Look for common field patterns across content types
    const contentTypes = await this.getContentTypes();
    
    for (const typeName of contentTypes) {
      const fields = await this.getFieldsForType(typeName);
      
      for (const field of fields) {
        // Skip system fields
        if (field.name.startsWith('_')) continue;
        
        // Check if field is a string type
        const fieldType = this.getBaseType(field.type);
        if (fieldType === 'String') {
          // Common searchable field patterns
          const searchablePatterns = [
            'title', 'heading', 'name', 'description', 
            'text', 'content', 'summary', 'body'
          ];
          
          const fieldNameLower = field.name.toLowerCase();
          if (searchablePatterns.some(pattern => fieldNameLower.includes(pattern))) {
            searchableFields.add(field.name);
          }
        }
      }
    }
    
    return Array.from(searchableFields);
  }

  /**
   * Build type-specific fields for inline fragments
   */
  private async buildTypeSpecificFields(
    contentTypes: string[], 
    options?: QueryBuilderOptions
  ): Promise<string> {
    const fragments: string[] = [];
    
    for (const typeName of contentTypes) {
      const fields = await this.getFieldsForType(typeName);
      if (fields.length === 0) continue;
      
      const fieldSelection = this.selectFields(fields, options);
      if (fieldSelection.length === 0) continue;
      
      fragments.push(`
        ... on ${typeName} {
          ${fieldSelection}
        }`);
    }
    
    return fragments.join('\n');
  }

  /**
   * Select fields based on options
   */
  private selectFields(
    fields: IntrospectionField[], 
    options?: QueryBuilderOptions
  ): string {
    let selectedFields = fields;
    
    // Apply field filters
    if (options?.excludeFields) {
      selectedFields = selectedFields.filter(f => 
        !options.excludeFields!.includes(f.name)
      );
    }
    
    if (options?.includeFields) {
      selectedFields = selectedFields.filter(f => 
        options.includeFields!.includes(f.name)
      );
    }
    
    // Skip system fields and complex types for now
    selectedFields = selectedFields.filter(f => {
      if (f.name.startsWith('_')) return false;
      
      const baseType = this.getBaseType(f.type);
      const type = this.typeMap.get(baseType);
      
      // Include scalars and enums
      if (!type || type.kind === 'SCALAR' || type.kind === 'ENUM') {
        return true;
      }
      
      // Include simple objects with depth limit
      if (type.kind === 'OBJECT' && (options?.maxDepth || 1) > 0) {
        return true;
      }
      
      return false;
    });
    
    return selectedFields.map(f => this.buildFieldSelection(f, options)).join('\n          ');
  }

  /**
   * Build field selection with nested fields if applicable
   */
  private buildFieldSelection(
    field: IntrospectionField, 
    options?: QueryBuilderOptions,
    depth: number = 0
  ): string {
    const baseType = this.getBaseType(field.type);
    const type = this.typeMap.get(baseType);
    
    if (!type || type.kind === 'SCALAR' || type.kind === 'ENUM') {
      return field.name;
    }
    
    if (type.kind === 'OBJECT' && depth < (options?.maxDepth || 1)) {
      const nestedFields = (type as any).fields as IntrospectionField[];
      const selectedNestedFields = nestedFields
        .filter(f => !f.name.startsWith('_'))
        .slice(0, 5) // Limit nested fields
        .map(f => this.buildFieldSelection(f, options, depth + 1))
        .join('\n            ');
      
      if (selectedNestedFields) {
        return `${field.name} {
            ${selectedNestedFields}
          }`;
      }
    }
    
    return field.name;
  }

  /**
   * Get base type name from a potentially wrapped type
   */
  private getBaseType(type: IntrospectionTypeRef): string {
    if (type.kind === 'NON_NULL' || type.kind === 'LIST') {
      return this.getBaseType(type.ofType!);
    }
    return (type as IntrospectionNamedTypeRef).name;
  }

  /**
   * Discover content types that might be returned by a query
   */
  private async discoverContentTypesForQuery(): Promise<string[]> {
    // Get all content types
    const allTypes = await this.getContentTypes();
    
    // In a real implementation, we might want to limit this based on
    // query context or user preferences
    return allTypes.slice(0, 10); // Limit to prevent huge queries
  }

  /**
   * Build a query for related content
   */
  async buildRelatedContentQuery(params: {
    contentId: string;
    direction: 'incoming' | 'outgoing';
    limit?: number;
  }): Promise<string> {
    await this.initialize();
    
    const commonFields = await this.getCommonContentFields();
    
    if (params.direction === 'outgoing') {
      return `
        query GetOutgoingRelations($contentId: String!, $limit: Int = ${params.limit || 20}) {
          content: _Content(
            where: { 
              _or: [
                { _metadata: { key: { eq: $contentId } } }
                { _metadata: { guid: { eq: $contentId } } }
              ]
            }
            limit: 1
          ) {
            items {
              ${commonFields}
              _references(limit: $limit) {
                ${commonFields}
              }
            }
          }
        }
      `;
    } else {
      return `
        query GetIncomingRelations($contentId: String!, $limit: Int = ${params.limit || 20}) {
          content: _Content(
            where: {
              _references: {
                _metadata: { key: { eq: $contentId } }
              }
            }
            limit: $limit
          ) {
            items {
              ${commonFields}
            }
            total
          }
        }
      `;
    }
  }
}

// Export a singleton instance for reuse
let builderInstance: IntelligentQueryBuilder | null = null;

export async function getIntelligentQueryBuilder(
  client: OptimizelyGraphClient
): Promise<IntelligentQueryBuilder> {
  if (!builderInstance) {
    builderInstance = new IntelligentQueryBuilder(client);
    await builderInstance.initialize();
  }
  return builderInstance;
}

/**
 * Helper function to create an intelligent query builder for a given config
 */
export async function createIntelligentQueryBuilder(
  config: GraphConfig
): Promise<IntelligentQueryBuilder> {
  const client = new OptimizelyGraphClient(config);
  return getIntelligentQueryBuilder(client);
}