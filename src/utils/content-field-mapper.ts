/**
 * Dynamic field mapper that discovers and maps content fields based on actual schema
 */

import { IntrospectionField, IntrospectionObjectType } from 'graphql';
import { OptimizelyGraphClient } from '../clients/graph-client.js';
import { SchemaIntrospector } from '../logic/graph/schema-introspector.js';
import { getLogger } from './logger.js';
import { withCache } from './cache.js';

export interface ContentFieldInfo {
  typeName: string;
  fields: Map<string, FieldMapping>;
  commonTextFields: string[];
  metadataFields: string[];
}

export interface FieldMapping {
  actualName: string;
  type: string;
  description?: string;
  isRequired: boolean;
}

export class ContentFieldMapper {
  private introspector: SchemaIntrospector;
  private logger = getLogger();
  private fieldMappingCache = new Map<string, ContentFieldInfo>();

  constructor(private client: OptimizelyGraphClient) {
    this.introspector = new SchemaIntrospector(client);
  }

  /**
   * Get field mappings for a specific content type
   */
  async getFieldsForContentType(typeName: string): Promise<ContentFieldInfo | null> {
    // Check cache first
    if (this.fieldMappingCache.has(typeName)) {
      return this.fieldMappingCache.get(typeName)!;
    }

    // Use general cache as well
    return await withCache(
      `field-mapping:${typeName}`,
      async () => {
        await this.introspector.initialize();
        
        const contentType = await this.introspector.getContentType(typeName);
        if (!contentType) {
          this.logger.warn(`Content type ${typeName} not found`);
          return null;
        }

        const fieldInfo = await this.analyzeContentTypeFields(typeName, contentType.fields);
        this.fieldMappingCache.set(typeName, fieldInfo);
        
        return fieldInfo;
      },
      3600 // Cache for 1 hour
    );
  }

  /**
   * Discover common text fields across all content types
   */
  async discoverCommonTextFields(): Promise<Map<string, string[]>> {
    return await withCache(
      'common-text-fields',
      async () => {
        await this.introspector.initialize();
        
        const contentTypes = await this.introspector.getContentTypes();
        const textFieldsByType = new Map<string, string[]>();

        for (const contentType of contentTypes) {
          const textFields: string[] = [];
          
          for (const field of contentType.fields) {
            if (field.type === 'String' && !field.name.startsWith('_')) {
              // Common patterns for text content fields
              const contentPatterns = [
                'content', 'body', 'text', 'description', 
                'summary', 'excerpt', 'article', 'mainbody'
              ];
              
              const fieldLower = field.name.toLowerCase();
              if (contentPatterns.some(pattern => fieldLower.includes(pattern))) {
                textFields.push(field.name);
              }
            }
          }

          if (textFields.length > 0) {
            textFieldsByType.set(contentType.name, textFields);
          }
        }

        return textFieldsByType;
      },
      3600 // Cache for 1 hour
    );
  }

  /**
   * Get the main content field for a specific content type
   */
  async getMainContentField(typeName: string): Promise<string | null> {
    const fieldInfo = await this.getFieldsForContentType(typeName);
    if (!fieldInfo) return null;

    // Generic patterns for discovering content fields dynamically
    const patterns = [
      'content',
      'body',
      'text',
      'description',
      'summary'
    ];

    // First, try exact matches
    for (const priority of priorities) {
      if (fieldInfo.fields.has(priority)) {
        return priority;
      }
    }

    // Then try case-insensitive and partial matches
    for (const priority of priorities) {
      const lowerPriority = priority.toLowerCase();
      for (const [fieldName, mapping] of fieldInfo.fields) {
        if (fieldName.toLowerCase() === lowerPriority ||
            fieldName.toLowerCase().includes(lowerPriority)) {
          return fieldName;
        }
      }
    }

    // Return the first text field if no specific match
    return fieldInfo.commonTextFields[0] || null;
  }

  /**
   * Build type-specific field selections for GraphQL queries
   */
  async buildTypeSpecificFields(typeName: string, maxDepth: number = 1): Promise<string> {
    const fieldInfo = await this.getFieldsForContentType(typeName);
    if (!fieldInfo) {
      return '';
    }

    const selections: string[] = [];

    for (const [fieldName, mapping] of fieldInfo.fields) {
      // Skip system fields
      if (fieldName.startsWith('_') && fieldName !== '_metadata') continue;

      // Include simple fields
      if (this.isSimpleType(mapping.type)) {
        selections.push(fieldName);
      } else if (maxDepth > 1 && mapping.type.includes('Block')) {
        // Include block fields with basic subfields
        selections.push(`${fieldName} {
              __typename
              _metadata {
                key
              }
            }`);
      }
    }

    return selections.join('\n            ');
  }

  /**
   * Analyze fields for a content type
   */
  private async analyzeContentTypeFields(
    typeName: string,
    fields: any[]
  ): Promise<ContentFieldInfo> {
    const fieldMap = new Map<string, FieldMapping>();
    const commonTextFields: string[] = [];
    const metadataFields: string[] = [];

    for (const field of fields) {
      const mapping: FieldMapping = {
        actualName: field.name,
        type: field.type,
        description: field.description,
        isRequired: field.isRequired || false
      };

      fieldMap.set(field.name, mapping);

      // Identify text content fields
      if (field.type === 'String' && !field.name.startsWith('_')) {
        const fieldLower = field.name.toLowerCase();
        const contentPatterns = ['content', 'body', 'text', 'description', 'summary'];
        
        if (contentPatterns.some(pattern => fieldLower.includes(pattern))) {
          commonTextFields.push(field.name);
        }
      }

      // Track metadata fields
      if (field.name === '_metadata' || field.name === 'metadata') {
        // This would need to be expanded to get actual metadata subfields
        metadataFields.push(field.name);
      }
    }

    return {
      typeName,
      fields: fieldMap,
      commonTextFields,
      metadataFields
    };
  }

  /**
   * Check if a type is simple (scalar or enum)
   */
  private isSimpleType(type: string): boolean {
    const simpleTypes = [
      'String', 'Int', 'Float', 'Boolean', 'ID',
      'Date', 'DateTime', 'Url', 'Html'
    ];
    return simpleTypes.includes(type);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.fieldMappingCache.clear();
  }
}

/**
 * Factory function to create a field mapper
 */
export async function createContentFieldMapper(
  client: OptimizelyGraphClient
): Promise<ContentFieldMapper> {
  const mapper = new ContentFieldMapper(client);
  return mapper;
}