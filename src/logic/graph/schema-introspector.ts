import { 
  IntrospectionQuery, 
  IntrospectionType, 
  IntrospectionField,
  IntrospectionTypeRef,
  IntrospectionNamedTypeRef,
  IntrospectionObjectType,
  IntrospectionInterfaceType,
  IntrospectionEnumType,
  IntrospectionInputObjectType
} from 'graphql';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { getLogger } from '../../utils/logger.js';
import { withCache } from '../../utils/cache.js';

export interface SchemaTypeInfo {
  name: string;
  kind: string;
  fields?: FieldInfo[];
  interfaces?: string[];
  possibleTypes?: string[];
  inputFields?: FieldInfo[];
  enumValues?: string[];
}

export interface FieldInfo {
  name: string;
  type: string;
  isList: boolean;
  isRequired: boolean;
  args?: ArgumentInfo[];
  description?: string;
}

export interface ArgumentInfo {
  name: string;
  type: string;
  defaultValue?: any;
  description?: string;
}

export interface ContentTypeInfo {
  name: string;
  fields: FieldInfo[];
  searchableFields: string[];
  metadataFields: string[];
  interfaces: string[];
}

/**
 * Comprehensive schema introspector that discovers and caches GraphQL schema information
 */
export class SchemaIntrospector {
  private schema: IntrospectionQuery | null = null;
  private typeMap: Map<string, IntrospectionType> = new Map();
  private contentTypeCache: Map<string, ContentTypeInfo> = new Map();
  private queryTypeInfo: SchemaTypeInfo | null = null;
  private logger = getLogger();

  constructor(private client: OptimizelyGraphClient) {}

  /**
   * Initialize the introspector by fetching and analyzing the schema
   */
  async initialize(): Promise<void> {
    if (this.schema) return;

    this.logger.debug('Fetching GraphQL schema for introspection');
    
    // Fetch schema with caching
    this.schema = await withCache(
      'graphql:schema:full',
      () => this.client.introspect(),
      3600 // Cache for 1 hour
    );

    // Build type map
    this.schema.__schema.types.forEach(type => {
      this.typeMap.set(type.name, type);
    });

    // Analyze query type
    const queryTypeName = this.schema.__schema.queryType.name;
    const queryType = this.typeMap.get(queryTypeName);
    if (queryType && queryType.kind === 'OBJECT') {
      this.queryTypeInfo = this.extractTypeInfo(queryType);
    }

    this.logger.info('Schema introspection completed', {
      typeCount: this.schema.__schema.types.length,
      queryFields: this.queryTypeInfo?.fields?.length || 0
    });
  }

  /**
   * Get the root query fields available in the schema
   */
  async getQueryFields(): Promise<FieldInfo[]> {
    await this.initialize();
    return this.queryTypeInfo?.fields || [];
  }

  /**
   * Find the actual content query field (might be _Content, Content, or something else)
   */
  async findContentQueryField(): Promise<string | null> {
    await this.initialize();
    
    const queryFields = await this.getQueryFields();
    
    // Look for common patterns
    const patterns = ['_Content', 'Content', 'content', '_content', 'Contents'];
    
    for (const pattern of patterns) {
      const field = queryFields.find(f => f.name === pattern);
      if (field) {
        this.logger.debug(`Found content query field: ${field.name}`);
        return field.name;
      }
    }

    // Look for fields that return lists of content types
    for (const field of queryFields) {
      if (field.isList && field.type.includes('Content')) {
        this.logger.debug(`Found potential content query field: ${field.name}`);
        return field.name;
      }
    }

    return null;
  }

  /**
   * Get all content types (concrete types that can be queried)
   */
  async getContentTypes(): Promise<ContentTypeInfo[]> {
    await this.initialize();

    const cachedResult = await withCache(
      'graphql:content-types',
      async () => {
        const contentTypes: ContentTypeInfo[] = [];

        for (const [typeName, type] of this.typeMap) {
          // Skip system types
          if (typeName.startsWith('__') || typeName.startsWith('_')) continue;
          
          if (type.kind === 'OBJECT') {
            const objectType = type as IntrospectionObjectType;
            
            // Check if it's a content type by looking for common interfaces
            const hasContentInterface = objectType.interfaces?.some(i => 
              i.name === '_IContent' || 
              i.name === 'IContent' || 
              i.name === 'Content'
            );

            // Also check if it has metadata fields
            const hasMetadataField = objectType.fields?.some(f => 
              f.name === '_metadata' || 
              f.name === 'metadata'
            );

            if (hasContentInterface || hasMetadataField) {
              const contentType = await this.analyzeContentType(typeName, objectType);
              contentTypes.push(contentType);
            }
          }
        }

        return contentTypes;
      },
      3600 // Cache for 1 hour
    );

    return cachedResult || [];
  }

  /**
   * Get specific content type information
   */
  async getContentType(typeName: string): Promise<ContentTypeInfo | null> {
    await this.initialize();

    if (this.contentTypeCache.has(typeName)) {
      return this.contentTypeCache.get(typeName)!;
    }

    const type = this.typeMap.get(typeName);
    if (!type || type.kind !== 'OBJECT') {
      return null;
    }

    const contentType = await this.analyzeContentType(typeName, type as IntrospectionObjectType);
    this.contentTypeCache.set(typeName, contentType);
    
    return contentType;
  }

  /**
   * Get all types that implement a specific interface
   * Used to discover component types implementing _IComponent
   */
  async getTypesImplementing(interfaceName: string): Promise<string[]> {
    await this.initialize();

    const interfaceType = this.typeMap.get(interfaceName);
    if (!interfaceType || interfaceType.kind !== 'INTERFACE') {
      this.logger.warn(`Interface not found: ${interfaceName}`);
      return [];
    }

    const intType = interfaceType as IntrospectionInterfaceType;
    const implementingTypes = (intType.possibleTypes || []).map(t => t.name);

    this.logger.debug(`Found ${implementingTypes.length} types implementing ${interfaceName}`, {
      types: implementingTypes
    });

    return implementingTypes;
  }

  /**
   * Find the metadata type structure
   */
  async getMetadataType(): Promise<SchemaTypeInfo | null> {
    await this.initialize();

    // Look for common metadata type names
    const patterns = ['ContentMetadata', '_ContentMetadata', 'Metadata', '_Metadata', 'IContentMetadata'];
    
    for (const pattern of patterns) {
      const type = this.typeMap.get(pattern);
      if (type) {
        return this.extractTypeInfo(type);
      }
    }

    // If not found, look for it in content types
    const contentTypes = await this.getContentTypes();
    if (contentTypes.length > 0) {
      const sampleType = this.typeMap.get(contentTypes[0].name);
      if (sampleType && sampleType.kind === 'OBJECT') {
        const metadataField = (sampleType as IntrospectionObjectType).fields?.find(f => 
          f.name === '_metadata' || f.name === 'metadata'
        );
        
        if (metadataField) {
          const metadataTypeName = this.getBaseTypeName(metadataField.type);
          const metadataType = this.typeMap.get(metadataTypeName);
          if (metadataType) {
            return this.extractTypeInfo(metadataType);
          }
        }
      }
    }

    return null;
  }

  /**
   * Get searchable fields for content
   */
  async getSearchableFields(): Promise<string[]> {
    await this.initialize();

    const searchableFields = new Set<string>();

    // Always include metadata fields
    const metadataType = await this.getMetadataType();
    if (metadataType?.fields) {
      metadataType.fields.forEach(field => {
        if (field.type === 'String' || field.type.includes('String')) {
          searchableFields.add(`_metadata.${field.name}`);
        }
      });
    }

    // Analyze content types for common searchable patterns
    const contentTypes = await this.getContentTypes();
    const fieldFrequency = new Map<string, number>();

    for (const contentType of contentTypes) {
      contentType.searchableFields.forEach(field => {
        const count = fieldFrequency.get(field) || 0;
        fieldFrequency.set(field, count + 1);
      });
    }

    // Include fields that appear in multiple content types
    const threshold = Math.max(1, Math.floor(contentTypes.length * 0.3));
    fieldFrequency.forEach((count, field) => {
      if (count >= threshold) {
        searchableFields.add(field);
      }
    });

    return Array.from(searchableFields);
  }

  /**
   * Build a where clause type for a content query
   */
  async getWhereInputType(contentQueryField: string): Promise<SchemaTypeInfo | null> {
    await this.initialize();

    const queryFields = await this.getQueryFields();
    const contentField = queryFields.find(f => f.name === contentQueryField);
    
    if (!contentField?.args) return null;

    const whereArg = contentField.args.find(arg => arg.name === 'where');
    if (!whereArg) return null;

    const whereType = this.typeMap.get(whereArg.type);
    if (whereType) {
      return this.extractTypeInfo(whereType);
    }

    return null;
  }

  /**
   * Analyze a content type and extract useful information
   */
  private async analyzeContentType(
    typeName: string, 
    type: IntrospectionObjectType
  ): Promise<ContentTypeInfo> {
    const fields: FieldInfo[] = [];
    const searchableFields: string[] = [];
    const metadataFields: string[] = [];

    for (const field of type.fields || []) {
      const fieldInfo = this.extractFieldInfo(field);
      fields.push(fieldInfo);

      // Identify searchable fields
      if (this.isSearchableField(field)) {
        searchableFields.push(field.name);
      }

      // Track metadata fields
      if (field.name === '_metadata' || field.name === 'metadata') {
        const metadataType = this.getFieldType(field.type);
        if (metadataType && metadataType.kind === 'OBJECT') {
          const metaType = metadataType as IntrospectionObjectType;
          metaType.fields?.forEach(mf => {
            metadataFields.push(mf.name);
          });
        }
      }
    }

    return {
      name: typeName,
      fields,
      searchableFields,
      metadataFields,
      interfaces: type.interfaces?.map(i => i.name) || []
    };
  }

  /**
   * Extract type information from an introspection type
   */
  private extractTypeInfo(type: IntrospectionType): SchemaTypeInfo {
    const info: SchemaTypeInfo = {
      name: type.name,
      kind: type.kind
    };

    switch (type.kind) {
      case 'OBJECT':
        const objType = type as IntrospectionObjectType;
        info.fields = objType.fields?.map(f => this.extractFieldInfo(f)) || [];
        info.interfaces = objType.interfaces?.map(i => i.name) || [];
        break;
        
      case 'INTERFACE':
        const intType = type as IntrospectionInterfaceType;
        info.fields = intType.fields?.map(f => this.extractFieldInfo(f)) || [];
        info.possibleTypes = intType.possibleTypes?.map(t => t.name) || [];
        break;
        
      case 'INPUT_OBJECT':
        const inputType = type as IntrospectionInputObjectType;
        info.inputFields = inputType.inputFields?.map(f => this.extractFieldInfo(f)) || [];
        break;
        
      case 'ENUM':
        const enumType = type as IntrospectionEnumType;
        info.enumValues = enumType.enumValues?.map(v => v.name) || [];
        break;
    }

    return info;
  }

  /**
   * Extract field information
   */
  private extractFieldInfo(field: IntrospectionField): FieldInfo {
    const { typeName, isList, isRequired } = this.parseFieldType(field.type);
    
    const fieldInfo: FieldInfo = {
      name: field.name,
      type: typeName,
      isList,
      isRequired,
      description: field.description || undefined
    };

    if (field.args && field.args.length > 0) {
      fieldInfo.args = field.args.map(arg => ({
        name: arg.name,
        type: this.getBaseTypeName(arg.type),
        defaultValue: arg.defaultValue,
        description: arg.description || undefined
      }));
    }

    return fieldInfo;
  }

  /**
   * Parse field type to extract base type, list, and required info
   */
  private parseFieldType(type: IntrospectionTypeRef): {
    typeName: string;
    isList: boolean;
    isRequired: boolean;
  } {
    let isList = false;
    let isRequired = false;
    let currentType = type;

    while (currentType.kind === 'NON_NULL' || currentType.kind === 'LIST') {
      if (currentType.kind === 'NON_NULL') {
        isRequired = true;
      } else if (currentType.kind === 'LIST') {
        isList = true;
      }
      currentType = currentType.ofType!;
    }

    return {
      typeName: (currentType as IntrospectionNamedTypeRef).name,
      isList,
      isRequired
    };
  }

  /**
   * Get base type name from a type reference
   */
  private getBaseTypeName(type: IntrospectionTypeRef): string {
    if (type.kind === 'NON_NULL' || type.kind === 'LIST') {
      return this.getBaseTypeName(type.ofType!);
    }
    return (type as IntrospectionNamedTypeRef).name;
  }

  /**
   * Get the actual type from a type reference
   */
  private getFieldType(type: IntrospectionTypeRef): IntrospectionType | null {
    const typeName = this.getBaseTypeName(type);
    return this.typeMap.get(typeName) || null;
  }

  /**
   * Check if a field is potentially searchable
   */
  private isSearchableField(field: IntrospectionField): boolean {
    const baseType = this.getBaseTypeName(field.type);
    
    // String fields are searchable
    if (baseType === 'String') {
      // Common searchable field patterns
      const searchablePatterns = [
        'title', 'heading', 'name', 'description',
        'text', 'content', 'summary', 'body', 'excerpt'
      ];
      
      const fieldNameLower = field.name.toLowerCase();
      return searchablePatterns.some(pattern => fieldNameLower.includes(pattern));
    }
    
    return false;
  }
}