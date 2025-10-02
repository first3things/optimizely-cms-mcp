/**
 * Dynamic field discovery system that uses type-get-schema to discover actual fields
 * This replaces the hardcoded field-mapper.ts with a truly dynamic approach
 */

import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { getLogger } from '../../utils/logger.js';
import { withCache } from '../../utils/cache.js';

const logger = getLogger();

export interface SchemaField {
  name: string;
  displayName: string;
  description?: string;
  type: string;
  required: boolean;
  metadata?: any;
}

export interface ContentTypeSchema {
  name: string;
  displayName: string;
  description?: string;
  fields: SchemaField[];
  requiredFields: string[];
}

export interface FieldDiscoveryResult {
  schema: ContentTypeSchema;
  availableFields: string[];
  fieldDetails: Record<string, SchemaField>;
  suggestions: FieldMappingSuggestion[];
}

export interface FieldMappingSuggestion {
  userField: string;
  suggestedField: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export class SchemaFieldDiscovery {
  private client: OptimizelyContentClient;

  constructor(config: CMAConfig) {
    this.client = new OptimizelyContentClient(config);
  }

  /**
   * Get the actual schema for a content type from the CMS
   */
  async getContentTypeSchema(contentType: string): Promise<ContentTypeSchema> {
    return withCache(
      `schema:${contentType}`,
      async () => {
        logger.info(`Fetching schema for content type: ${contentType}`);
        
        try {
          const typeData = await this.client.get<any>(`/contentTypes/${contentType}`);
          
          if (!typeData) {
            logger.warn(`No data returned for content type: ${contentType}`);
            throw new Error(`Content type '${contentType}' not found`);
          }
          
          const fields: SchemaField[] = [];
          const requiredFields: string[] = [];
          
          // Extract field information from the schema
          if (typeData.properties && typeof typeData.properties === 'object') {
            for (const [fieldName, fieldDef] of Object.entries(typeData.properties as Record<string, any>)) {
              const field: SchemaField = {
                name: fieldName,
                displayName: (fieldDef as any).displayName || fieldName,
                description: (fieldDef as any).description,
                type: (fieldDef as any).dataType || 'string',
                required: (fieldDef as any).required || false,
                metadata: (fieldDef as any).settings
              };
              
              fields.push(field);
              
              if (field.required) {
                requiredFields.push(fieldName);
              }
            }
          }
          
          const schema: ContentTypeSchema = {
            name: typeData.key || contentType,
            displayName: typeData.displayName || contentType,
            description: typeData.description,
            fields,
            requiredFields
          };
          
          logger.info(`Schema discovered for ${contentType}:`, {
            fieldCount: fields.length,
            requiredCount: requiredFields.length
          });
          
          return schema;
        } catch (error) {
          logger.error(`Failed to fetch schema for ${contentType}:`, error);
          throw error;
        }
      },
      600 // Cache for 10 minutes
    );
  }

  /**
   * Discover fields and provide mapping suggestions for user input
   */
  async discoverFields(
    contentType: string,
    userProperties: Record<string, any>
  ): Promise<FieldDiscoveryResult> {
    const schema = await this.getContentTypeSchema(contentType);
    
    // Create a map of field details for quick lookup
    const fieldDetails: Record<string, SchemaField> = {};
    const availableFields: string[] = [];
    
    if (Array.isArray(schema.fields)) {
      for (const field of schema.fields) {
        fieldDetails[field.name] = field;
        availableFields.push(field.name);
      }
    }
    
    // Generate mapping suggestions
    const suggestions = this.generateMappingSuggestions(
      userProperties,
      fieldDetails,
      schema
    );
    
    return {
      schema,
      availableFields,
      fieldDetails,
      suggestions
    };
  }

  /**
   * Generate intelligent field mapping suggestions
   */
  private generateMappingSuggestions(
    userProperties: Record<string, any>,
    fieldDetails: Record<string, SchemaField>,
    _schema: ContentTypeSchema
  ): FieldMappingSuggestion[] {
    const suggestions: FieldMappingSuggestion[] = [];
    
    for (const [userField, _value] of Object.entries(userProperties)) {
      // Skip if field already exists exactly
      if (fieldDetails[userField]) {
        continue;
      }
      
      // Try to find the best match
      const suggestion = this.findBestFieldMatch(userField, fieldDetails);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }
    
    return suggestions;
  }

  /**
   * Find the best matching field for a user-provided field name
   */
  private findBestFieldMatch(
    userField: string,
    fieldDetails: Record<string, SchemaField>
  ): FieldMappingSuggestion | null {
    const userFieldLower = userField.toLowerCase();
    const userFieldWords = this.extractWords(userField);
    
    let bestMatch: FieldMappingSuggestion | null = null;
    let bestScore = 0;
    
    for (const [actualField, fieldDef] of Object.entries(fieldDetails)) {
      const actualFieldLower = actualField.toLowerCase();
      const actualFieldWords = this.extractWords(actualField);
      
      // Exact match (case-insensitive)
      if (userFieldLower === actualFieldLower) {
        return {
          userField,
          suggestedField: actualField,
          confidence: 'high',
          reason: 'Case-insensitive exact match'
        };
      }
      
      // Check common patterns
      const score = this.calculateFieldMatchScore(
        userFieldLower,
        userFieldWords,
        actualFieldLower,
        actualFieldWords,
        fieldDef
      );
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          userField,
          suggestedField: actualField,
          confidence: score > 0.8 ? 'high' : score > 0.5 ? 'medium' : 'low',
          reason: this.getMatchReason(userField, actualField, fieldDef)
        };
      }
    }
    
    // Only return suggestions with reasonable confidence
    return bestScore > 0.3 ? bestMatch : null;
  }

  /**
   * Extract words from a field name for comparison
   */
  private extractWords(fieldName: string): string[] {
    // Split by camelCase, PascalCase, snake_case, kebab-case
    return fieldName
      .split(/(?=[A-Z])|[_-]/)
      .map(w => w.toLowerCase())
      .filter(w => w.length > 0);
  }

  /**
   * Calculate a match score between user field and actual field
   */
  private calculateFieldMatchScore(
    userFieldLower: string,
    userFieldWords: string[],
    actualFieldLower: string,
    actualFieldWords: string[],
    fieldDef: SchemaField
  ): number {
    let score = 0;
    
    // Check if one contains the other
    if (actualFieldLower.includes(userFieldLower) || userFieldLower.includes(actualFieldLower)) {
      score += 0.5;
    }
    
    // Check word overlap
    const commonWords = userFieldWords.filter(w => actualFieldWords.includes(w));
    if (commonWords.length > 0) {
      score += (commonWords.length / Math.max(userFieldWords.length, actualFieldWords.length)) * 0.4;
    }
    
    // Check common patterns
    const patterns = this.getCommonFieldPatterns();
    for (const [pattern, fields] of Object.entries(patterns)) {
      if (fields.includes(userFieldLower) && actualFieldLower.includes(pattern)) {
        score += 0.3;
        break;
      }
    }
    
    // Check field type compatibility
    if (fieldDef.displayName) {
      const displayNameLower = fieldDef.displayName.toLowerCase();
      if (displayNameLower.includes(userFieldLower) || userFieldLower.includes(displayNameLower)) {
        score += 0.2;
      }
    }
    
    return Math.min(score, 1);
  }

  /**
   * Get common field name patterns for matching
   */
  private getCommonFieldPatterns(): Record<string, string[]> {
    return {
      'title': ['title', 'heading', 'name', 'headline'],
      'content': ['content', 'body', 'text', 'description', 'article'],
      'summary': ['summary', 'excerpt', 'abstract', 'brief', 'intro'],
      'author': ['author', 'writer', 'creator', 'by'],
      'date': ['date', 'published', 'created', 'updated', 'time'],
      'image': ['image', 'photo', 'picture', 'thumbnail', 'banner'],
      'meta': ['meta', 'seo', 'metadata', 'og'],
      'tags': ['tags', 'categories', 'labels', 'topics']
    };
  }

  /**
   * Get a human-readable reason for the field match
   */
  private getMatchReason(userField: string, actualField: string, fieldDef: SchemaField): string {
    const userLower = userField.toLowerCase();
    const actualLower = actualField.toLowerCase();
    
    if (actualLower.includes(userLower)) {
      return `Field name contains "${userField}"`;
    }
    
    if (fieldDef.displayName?.toLowerCase().includes(userLower)) {
      return `Display name "${fieldDef.displayName}" matches`;
    }
    
    const patterns = this.getCommonFieldPatterns();
    for (const [pattern, fields] of Object.entries(patterns)) {
      if (fields.includes(userLower) && actualLower.includes(pattern)) {
        return `Common ${pattern} field pattern`;
      }
    }
    
    return 'Similar field name pattern';
  }

  /**
   * Map user properties to actual schema fields dynamically
   */
  async mapFieldsDynamically(
    contentType: string,
    userProperties: Record<string, any>
  ): Promise<{
    mappedProperties: Record<string, any>;
    unmappedFields: string[];
    mappingSuggestions: FieldMappingSuggestion[];
  }> {
    const discovery = await this.discoverFields(contentType, userProperties);
    const mappedProperties: Record<string, any> = {};
    const unmappedFields: string[] = [];
    
    for (const [userField, value] of Object.entries(userProperties)) {
      // Check if field exists exactly in schema
      if (discovery.fieldDetails[userField]) {
        mappedProperties[userField] = value;
        continue;
      }
      
      // Check for suggested mapping
      const suggestion = Array.isArray(discovery.suggestions) 
        ? discovery.suggestions.find(s => s.userField === userField)
        : undefined;
      if (suggestion && suggestion.confidence !== 'low') {
        // Handle nested field mappings (e.g., Settings.Title)
        if (suggestion.suggestedField.includes('.')) {
          this.setNestedField(mappedProperties, suggestion.suggestedField, value);
        } else {
          mappedProperties[suggestion.suggestedField] = value;
        }
        logger.info(`Mapped field "${userField}" to "${suggestion.suggestedField}" (${suggestion.reason})`);
      } else {
        // No good mapping found
        unmappedFields.push(userField);
        // Still include it in case the API accepts it
        mappedProperties[userField] = value;
      }
    }
    
    return {
      mappedProperties,
      unmappedFields,
      mappingSuggestions: discovery.suggestions
    };
  }
  
  /**
   * Set a nested field value using dot notation
   */
  private setNestedField(obj: Record<string, any>, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    
    let current = obj;
    for (const key of keys) {
      if (!current[key]) {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[lastKey] = value;
  }

  /**
   * Get a formatted field guide for Claude to show users
   */
  async getFieldGuide(contentType: string): Promise<string> {
    const schema = await this.getContentTypeSchema(contentType);
    
    let guide = `Available fields for ${schema.displayName || contentType}:\n\n`;
    
    // Required fields
    if (schema.requiredFields && schema.requiredFields.length > 0) {
      guide += 'Required fields:\n';
      for (const fieldName of schema.requiredFields) {
        const field = Array.isArray(schema.fields) 
          ? schema.fields.find(f => f.name === fieldName)
          : undefined;
        if (field) {
          guide += `  - ${field.name} (${field.type})`;
          if (field.displayName !== field.name) {
            guide += ` - "${field.displayName}"`;
          }
          if (field.description) {
            guide += ` - ${field.description}`;
          }
          guide += '\n';
        }
      }
      guide += '\n';
    }
    
    // Optional fields
    const optionalFields = Array.isArray(schema.fields) 
      ? schema.fields.filter(f => !f.required)
      : [];
    if (optionalFields.length > 0) {
      guide += 'Optional fields:\n';
      for (const field of optionalFields) {
        guide += `  - ${field.name} (${field.type})`;
        if (field.displayName !== field.name) {
          guide += ` - "${field.displayName}"`;
        }
        if (field.description) {
          guide += ` - ${field.description}`;
        }
        guide += '\n';
      }
    }
    
    return guide;
  }
}