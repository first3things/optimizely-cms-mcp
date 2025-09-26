import { OptimizelyGraphClient } from '../clients/graph-client.js';
import { GraphConfig } from '../types/config.js';
import { getLogger } from '../utils/logger.js';
import { withCache } from '../utils/cache.js';
import {
  IntrospectionQuery,
  GraphQLSchema,
  buildClientSchema,
  getIntrospectionQuery,
  GraphQLFieldMap,
  isObjectType,
  isInterfaceType,
  isUnionType,
  GraphQLObjectType,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLType,
  isNonNullType,
  isListType,
  GraphQLField
} from 'graphql';
import { validateGraphQLQuery } from '../utils/graphql-validator.js';

export interface ContentTypeInfo {
  name: string;
  fields: Record<string, FieldInfo>;
  interfaces: string[];
  description?: string;
}

export interface FieldInfo {
  name: string;
  type: string;
  description?: string;
  isRequired: boolean;
  isList: boolean;
  isSearchable?: boolean;
  isFilterable?: boolean;
}

export interface SchemaInfo {
  contentTypes: Map<string, ContentTypeInfo>;
  searchableFields: Set<string>;
  filterableFields: Set<string>;
  metadataFields: Set<string>;
  commonFields: Set<string>;
}

/**
 * Service for discovering and caching GraphQL schema information
 */
export class SchemaDiscoveryService {
  private logger = getLogger();
  private schema: GraphQLSchema | null = null;
  private schemaInfo: SchemaInfo | null = null;
  private initializationPromise: Promise<void> | null = null;
  private isInitialized = false;
  
  constructor(private client: OptimizelyGraphClient) {}

  /**
   * Initialize the schema discovery service
   */
  async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized && this.schema) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start initialization
    this.initializationPromise = this._doInitialize();
    
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async _doInitialize(): Promise<void> {
    try {
      this.logger.info('Initializing schema discovery service...');
      
      // Fetch introspection data with caching
      const introspectionData = await this.fetchIntrospection();
      
      // Build GraphQL schema from introspection
      this.schema = buildClientSchema(introspectionData);
      
      // Analyze schema for searchable fields and content types
      this.schemaInfo = await this.analyzeSchema(this.schema);
      
      this.isInitialized = true;
      this.logger.info('Schema discovery service initialized successfully');
      this.logger.debug(`Discovered ${this.schemaInfo.contentTypes.size} content types`);
      this.logger.debug(`Found ${this.schemaInfo.searchableFields.size} searchable fields`);
      
    } catch (error) {
      this.logger.error('Failed to initialize schema discovery service', error);
      throw error;
    }
  }

  /**
   * Fetch introspection data with caching
   */
  private async fetchIntrospection(): Promise<IntrospectionQuery> {
    return await withCache(
      'schema:introspection',
      async () => {
        this.logger.debug('Fetching GraphQL introspection...');
        const introspectionQuery = getIntrospectionQuery();
        const result = await this.client.query<IntrospectionQuery>(introspectionQuery);
        return result;
      },
      7200 // Cache for 2 hours
    );
  }

  /**
   * Analyze schema to extract useful information
   */
  private async analyzeSchema(schema: GraphQLSchema): Promise<SchemaInfo> {
    const contentTypes = new Map<string, ContentTypeInfo>();
    const searchableFields = new Set<string>();
    const filterableFields = new Set<string>();
    const metadataFields = new Set<string>();
    const commonFields = new Set<string>();

    // Get the Query type
    const queryType = schema.getQueryType();
    if (!queryType) {
      throw new Error('No Query type found in schema');
    }

    // Find the _Content field
    const contentField = queryType.getFields()['_Content'];
    if (contentField) {
      // Analyze the where input type to find filterable fields
      const whereArg = contentField.args.find(arg => arg.name === 'where');
      if (whereArg) {
        this.analyzeWhereInputType(whereArg.type, filterableFields);
      }
    }

    // Analyze all object types in the schema
    const typeMap = schema.getTypeMap();
    for (const [typeName, type] of Object.entries(typeMap)) {
      // Skip internal types
      if (typeName.startsWith('__') || typeName.startsWith('_')) {
        continue;
      }

      if (isObjectType(type) || isInterfaceType(type)) {
        const fields = type.getFields();
        
        // Check if this is a content type (implements _IContent or has _metadata)
        const hasMetadata = '_metadata' in fields;
        const implementsIContent = isObjectType(type) && 
          type.getInterfaces().some(iface => iface.name === '_IContent');
        
        if (hasMetadata || implementsIContent) {
          const contentType = this.extractContentTypeInfo(type, fields);
          contentTypes.set(typeName, contentType);
          
          // Extract searchable fields
          for (const fieldName of Object.keys(fields)) {
            if (this.isSearchableField(fields[fieldName])) {
              searchableFields.add(fieldName);
            }
          }
        }

        // Extract metadata fields from _Metadata type
        if (typeName === '_Metadata') {
          for (const fieldName of Object.keys(fields)) {
            metadataFields.add(fieldName);
          }
        }
      }
    }

    // Find common fields across all content types
    if (contentTypes.size > 0) {
      const allFieldSets = Array.from(contentTypes.values()).map(
        ct => new Set(Object.keys(ct.fields))
      );
      
      const firstSet = allFieldSets[0];
      for (const field of firstSet) {
        if (allFieldSets.every(set => set.has(field))) {
          commonFields.add(field);
        }
      }
    }

    return {
      contentTypes,
      searchableFields,
      filterableFields,
      metadataFields,
      commonFields
    };
  }

  /**
   * Analyze where input type to find filterable fields
   */
  private analyzeWhereInputType(type: GraphQLType, filterableFields: Set<string>): void {
    // Unwrap non-null and list types
    while (isNonNullType(type) || isListType(type)) {
      type = type.ofType;
    }

    const typeName = 'name' in type ? type.name : '';
    
    // Look for the _ContentWhereInput type
    if (typeName === '_ContentWhereInput' || typeName.endsWith('WhereInput')) {
      const schema = this.schema!;
      const actualType = schema.getType(typeName);
      
      if (actualType && 'getFields' in actualType) {
        const fields = (actualType as any).getFields();
        for (const fieldName of Object.keys(fields)) {
          if (!fieldName.startsWith('_')) {
            filterableFields.add(fieldName);
          }
        }
      }
    }
  }

  /**
   * Extract content type information
   */
  private extractContentTypeInfo(
    type: GraphQLObjectType | GraphQLInterfaceType,
    fields: GraphQLFieldMap<any, any>
  ): ContentTypeInfo {
    const contentFields: Record<string, FieldInfo> = {};
    
    for (const [fieldName, field] of Object.entries(fields)) {
      contentFields[fieldName] = this.extractFieldInfo(field);
    }

    return {
      name: type.name,
      fields: contentFields,
      interfaces: isObjectType(type) ? type.getInterfaces().map(i => i.name) : [],
      description: type.description || undefined
    };
  }

  /**
   * Extract field information
   */
  private extractFieldInfo(field: GraphQLField<any, any>): FieldInfo {
    let fieldType = field.type;
    let isRequired = false;
    let isList = false;

    // Unwrap modifiers
    if (isNonNullType(fieldType)) {
      isRequired = true;
      fieldType = fieldType.ofType;
    }

    if (isListType(fieldType)) {
      isList = true;
      fieldType = fieldType.ofType;
    }

    // Handle nested non-null
    if (isNonNullType(fieldType)) {
      fieldType = fieldType.ofType;
    }

    const typeName = 'name' in fieldType ? fieldType.name : 'Unknown';

    return {
      name: field.name,
      type: typeName,
      description: field.description || undefined,
      isRequired,
      isList,
      isSearchable: this.isSearchableField(field),
      isFilterable: this.isFilterableField(field)
    };
  }

  /**
   * Check if a field is searchable (text fields)
   */
  private isSearchableField(field: GraphQLField<any, any>): boolean {
    const fieldType = this.getBaseType(field.type);
    const typeName = 'name' in fieldType ? fieldType.name : '';
    
    return ['String', 'SearchableString', 'XhtmlString'].includes(typeName);
  }

  /**
   * Check if a field is filterable
   */
  private isFilterableField(field: GraphQLField<any, any>): boolean {
    // All fields are potentially filterable in Optimizely Graph
    return true;
  }

  /**
   * Get the base type by unwrapping modifiers
   */
  private getBaseType(type: GraphQLType): GraphQLType {
    while (isNonNullType(type) || isListType(type)) {
      type = type.ofType;
    }
    return type;
  }

  /**
   * Ensure service is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Get the GraphQL schema
   */
  async getSchema(): Promise<GraphQLSchema> {
    await this.ensureInitialized();
    if (!this.schema) {
      throw new Error('Schema not available');
    }
    return this.schema;
  }

  /**
   * Get schema information
   */
  async getSchemaInfo(): Promise<SchemaInfo> {
    await this.ensureInitialized();
    if (!this.schemaInfo) {
      throw new Error('Schema info not available');
    }
    return this.schemaInfo;
  }

  /**
   * Get available content types
   */
  async getContentTypes(): Promise<string[]> {
    const info = await this.getSchemaInfo();
    return Array.from(info.contentTypes.keys()).sort();
  }

  /**
   * Get searchable fields
   */
  async getSearchableFields(): Promise<string[]> {
    const info = await this.getSchemaInfo();
    return Array.from(info.searchableFields).sort();
  }

  /**
   * Get fields for a specific content type
   */
  async getContentTypeFields(typeName: string): Promise<FieldInfo[]> {
    const info = await this.getSchemaInfo();
    const contentType = info.contentTypes.get(typeName);
    
    if (!contentType) {
      throw new Error(`Content type ${typeName} not found`);
    }
    
    return Object.values(contentType.fields);
  }

  /**
   * Validate a GraphQL query against the schema
   */
  async validateQuery(query: string): Promise<{ valid: boolean; errors?: string[] }> {
    await this.ensureInitialized();
    if (!this.schema) {
      throw new Error('Schema not available for validation');
    }

    try {
      const errors = validateGraphQLQuery(query, this.schema);
      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      return {
        valid: false,
        errors: [(error as Error).message]
      };
    }
  }

  /**
   * Check if a field exists in metadata
   */
  async isMetadataField(fieldName: string): Promise<boolean> {
    const info = await this.getSchemaInfo();
    return info.metadataFields.has(fieldName);
  }

  /**
   * Get common fields across all content types
   */
  async getCommonFields(): Promise<string[]> {
    const info = await this.getSchemaInfo();
    return Array.from(info.commonFields).sort();
  }
}

/**
 * Singleton instance management
 */
let schemaDiscoveryInstance: SchemaDiscoveryService | null = null;

/**
 * Get or create schema discovery service instance
 */
export async function getSchemaDiscoveryService(
  config: GraphConfig
): Promise<SchemaDiscoveryService> {
  if (!schemaDiscoveryInstance) {
    const client = new OptimizelyGraphClient(config);
    schemaDiscoveryInstance = new SchemaDiscoveryService(client);
    await schemaDiscoveryInstance.initialize();
  }
  
  return schemaDiscoveryInstance;
}

/**
 * Clear the cached schema discovery instance
 */
export function clearSchemaDiscoveryCache(): void {
  schemaDiscoveryInstance = null;
}