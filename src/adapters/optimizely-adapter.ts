/**
 * Optimizely CMS Adapter
 * Implements intelligent schema discovery and field management for Optimizely CMS
 */

import {
  BaseCMSAdapter,
  ContentTypeInfo,
  ContentTypeSchema,
  PropertyDefinition,
  FieldDefault,
  ValidationResult,
  PropertyType
} from './base.js';
import { OptimizelyContentClient } from '../clients/cma-client.js';
import { CMAConfig } from '../types/config.js';
import { withCache } from '../utils/cache.js';
import { getLogger } from '../utils/logger.js';

interface OptimizelyContentType {
  key: string;
  displayName: string;
  description?: string;
  baseType: string;
  properties?: Record<string, OptimizelyProperty>;
  mayContainTypes?: string[];
  source?: string;
  isContract?: boolean;
}

interface OptimizelyProperty {
  type: string;
  format?: string;
  required?: boolean;
  items?: { type: string };
  properties?: Record<string, OptimizelyProperty>;
  enum?: Array<string | { value: string; displayName: string }>;
  default?: any;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  contentType?: string; // For component types
}

export class OptimizelyAdapter extends BaseCMSAdapter {
  readonly name = 'Optimizely CMS';
  readonly version = '1.0.0';
  
  private client: OptimizelyContentClient;
  private logger = getLogger();
  
  constructor(private config: CMAConfig) {
    super();
    this.client = new OptimizelyContentClient(config);
  }

  async getContentTypes(): Promise<ContentTypeInfo[]> {
    return withCache('contentTypes', async () => {
      this.logger.debug('Fetching content types from Optimizely');
      
      const response = await this.client.get('/contentTypes');
      const types = response.items || [];
      
      return types.map((type: OptimizelyContentType) => ({
        key: type.key,
        displayName: type.displayName,
        description: type.description,
        baseType: type.baseType,
        category: this.mapBaseTypeToCategory(type.baseType),
        allowedChildren: type.mayContainTypes || [],
        allowedParents: [] // Would need another API call to determine
      }));
    }, 300); // Cache for 5 minutes
  }

  async getContentTypeSchema(typeName: string): Promise<ContentTypeSchema> {
    return withCache(`schema:${typeName}`, async () => {
      this.logger.debug(`Fetching schema for content type: ${typeName}`);
      
      // Get content type details
      const response = await this.client.get(`/contentTypes/${typeName}`);
      
      if (!response) {
        throw new Error(`Content type '${typeName}' not found`);
      }

      // Parse properties into our schema format, including component types
      const properties = await this.parsePropertiesWithComponents(response.properties || {});
      const required = await this.extractRequiredFieldsWithComponents(response.properties || {});
      const defaults = await this.extractDefaults(response.properties || {}, typeName);

      return {
        name: response.key,
        displayName: response.displayName,
        baseType: response.baseType,
        properties,
        required,
        defaults,
        validation: []
      };
    }, 600); // Cache for 10 minutes
  }

  private async parsePropertiesWithComponents(
    props: Record<string, OptimizelyProperty>, 
    parentPath = ''
  ): Promise<PropertyDefinition[]> {
    const definitions: PropertyDefinition[] = [];

    for (const [key, prop] of Object.entries(props)) {
      const path = parentPath ? `${parentPath}.${key}` : key;
      
      // Handle component types by fetching their schema
      if (prop.type === 'component' && (prop as any).contentType) {
        const componentType = (prop as any).contentType;
        this.logger.debug(`Found component type: ${componentType} at ${path}`);
        
        // Add the component itself
        definitions.push({
          name: key,
          path,
          type: 'object',
          required: prop.required || false,
          description: prop.description
        });
        
        try {
          // Fetch component schema
          const componentResponse = await this.client.get(`/contentTypes/${componentType}`);
          if (componentResponse && componentResponse.properties) {
            // Recursively parse component properties
            const componentProps = await this.parsePropertiesWithComponents(
              componentResponse.properties,
              path
            );
            definitions.push(...componentProps);
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch component type ${componentType}:`, error);
        }
      }
      // Handle nested objects
      else if (prop.type === 'object' && prop.properties) {
        // Add the object itself
        definitions.push({
          name: key,
          path,
          type: 'object',
          required: prop.required || false,
          description: prop.description
        });
        
        // Add nested properties
        const nestedProps = await this.parsePropertiesWithComponents(prop.properties, path);
        definitions.push(...nestedProps);
      } else {
        // Regular property
        definitions.push({
          name: key,
          path,
          type: this.mapPropertyType(prop.type, prop.format),
          required: prop.required || false,
          defaultValue: prop.default,
          allowedValues: prop.enum?.map((e: any) => e.value || e),
          description: prop.description,
          validation: this.extractValidation(prop)
        });
      }
    }

    return definitions;
  }

  private async extractRequiredFieldsWithComponents(
    props: Record<string, OptimizelyProperty>,
    parentPath = '',
    required: string[] = []
  ): Promise<string[]> {
    for (const [key, prop] of Object.entries(props)) {
      const path = parentPath ? `${parentPath}.${key}` : key;
      
      if (prop.required) {
        required.push(path);
      }
      
      // Handle component types
      if (prop.type === 'component' && (prop as any).contentType) {
        const componentType = (prop as any).contentType;
        try {
          // Fetch component schema to find its required fields
          const componentResponse = await this.client.get(`/contentTypes/${componentType}`);
          if (componentResponse && componentResponse.properties) {
            await this.extractRequiredFieldsWithComponents(
              componentResponse.properties,
              path,
              required
            );
          }
        } catch (error) {
          this.logger.warn(`Failed to get required fields for component ${componentType}:`, error);
        }
      }
      // Check nested properties
      else if (prop.type === 'object' && prop.properties) {
        await this.extractRequiredFieldsWithComponents(prop.properties, path, required);
      }
    }
    
    return required;
  }

  private async extractDefaults(
    props: Record<string, OptimizelyProperty>,
    contentType: string,
    parentPath = ''
  ): Promise<Record<string, any>> {
    const defaults: Record<string, any> = {};

    for (const [key, prop] of Object.entries(props)) {
      const path = parentPath ? `${parentPath}.${key}` : key;
      
      // Use explicit default if available
      if (prop.default !== undefined) {
        defaults[path] = prop.default;
      } else {
        // Generate smart default
        const smartDefault = await this.generateSmartDefaultForProperty(
          key,
          path,
          prop,
          contentType
        );
        if (smartDefault !== undefined) {
          defaults[path] = smartDefault;
        }
      }
      
      // Handle nested properties
      if (prop.type === 'object' && prop.properties) {
        const nestedDefaults = await this.extractDefaults(
          prop.properties,
          contentType,
          path
        );
        Object.assign(defaults, nestedDefaults);
      }
      // Handle component types
      else if (prop.type === 'component' && (prop as any).contentType) {
        const componentType = (prop as any).contentType;
        try {
          const componentResponse = await this.client.get(`/contentTypes/${componentType}`);
          if (componentResponse && componentResponse.properties) {
            const componentDefaults = await this.extractDefaults(
              componentResponse.properties,
              contentType,
              path
            );
            Object.assign(defaults, componentDefaults);
          }
        } catch (error) {
          this.logger.warn(`Failed to get defaults for component ${componentType}:`, error);
        }
      }
    }

    return defaults;
  }

  private async generateSmartDefaultForProperty(
    name: string,
    path: string,
    prop: OptimizelyProperty,
    contentType: string
  ): Promise<any> {
    const lowerName = name.toLowerCase();
    const lowerPath = path.toLowerCase();

    // Special handling for Optimizely-specific fields
    if (lowerPath === 'seosettings.graphtype') {
      return this.getSmartGraphType(contentType);
    }

    if (lowerPath === 'seosettings.displayinmenu') {
      return true; // Most pages should be in menu by default
    }

    if (lowerName === 'routesegment') {
      return ''; // Will be auto-generated from name
    }

    if (lowerName === 'status') {
      return 'draft';
    }

    // Use base class smart defaults
    const propDef: PropertyDefinition = {
      name,
      path,
      type: this.mapPropertyType(prop.type, prop.format),
      required: prop.required || false
    };

    return this.generateSmartDefault(propDef, contentType);
  }

  private mapPropertyType(type: string, format?: string): PropertyType {
    if (format === 'html') return 'html';
    if (format === 'url') return 'url';
    if (format === 'date-time') return 'date';
    
    switch (type) {
      case 'string': return 'string';
      case 'integer':
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'array': return 'array';
      case 'object': return 'object';
      default: return 'string';
    }
  }

  private extractValidation(prop: OptimizelyProperty): any {
    const validations = [];

    if (prop.minLength || prop.maxLength) {
      validations.push({
        type: 'length',
        value: { min: prop.minLength, max: prop.maxLength }
      });
    }

    if (prop.minimum || prop.maximum) {
      validations.push({
        type: 'range',
        value: { min: prop.minimum, max: prop.maximum }
      });
    }

    if (prop.enum) {
      validations.push({
        type: 'enum',
        value: prop.enum
      });
    }

    return validations.length > 0 ? validations[0] : undefined;
  }

  private mapBaseTypeToCategory(baseType: string): ContentTypeInfo['category'] {
    switch (baseType.toLowerCase()) {
      case '_page':
      case 'page':
        return 'page';
      case '_block':
      case 'block':
        return 'block';
      case '_media':
      case '_image':
      case '_video':
      case 'media':
        return 'media';
      case '_folder':
      case 'folder':
        return 'folder';
      case '_component':
      case 'component':
        return 'component';
      default:
        return 'other';
    }
  }

  async transformContent(
    content: any,
    contentType: string,
    operation: 'create' | 'update'
  ): Promise<any> {
    const transformed = { ...content };

    // Optimizely-specific transformations
    if (operation === 'create') {
      // Ensure displayName is set
      if (!transformed.displayName && transformed.name) {
        transformed.displayName = transformed.name;
      }

      // Ensure locale is set
      if (!transformed.locale) {
        transformed.locale = 'en';
      }

      // Remove fields that shouldn't be sent on create
      delete transformed.id;
      delete transformed.contentLink;
      delete transformed.key;
    }

    return transformed;
  }

  async getSuggestedValues(
    fieldPath: string,
    contentType: string,
    context?: Record<string, any>
  ): Promise<any[]> {
    // Optimizely-specific suggestions
    const lowerPath = fieldPath.toLowerCase();

    if (lowerPath === 'seosettings.graphtype') {
      return [
        'website',
        'article',
        'blog',
        'video.other',
        'video.movie',
        'video.episode',
        'video.tv_show',
        'product',
        'profile',
        'book'
      ];
    }

    if (lowerPath === 'status') {
      return ['draft', 'ready', 'published'];
    }

    if (lowerPath === 'locale' || lowerPath === 'language') {
      // Could fetch from API, but for now return common ones
      return ['en', 'sv', 'no', 'da', 'fi', 'es', 'fr', 'de'];
    }

    // Fall back to base implementation
    return super.getSuggestedValues(fieldPath, contentType, context);
  }

  async getFieldDefaults(typeName: string): Promise<FieldDefault[]> {
    const defaults = await super.getFieldDefaults(typeName);
    
    // Add Optimizely-specific conditional defaults
    defaults.push({
      field: 'SeoSettings.DisplayInMenu',
      value: true,
      condition: (contentType) => {
        // Hide from menu for certain types
        return !contentType.toLowerCase().includes('system');
      }
    });

    return defaults;
  }

  /**
   * Validate content with Optimizely-specific rules
   */
  async validateContent(
    content: any,
    schema: ContentTypeSchema
  ): Promise<ValidationResult> {
    const result = await super.validateContent(content, schema);

    // Additional Optimizely-specific validation
    const warnings = result.warnings || [];

    // Warn if SEO fields are empty
    if (!content.properties?.SeoSettings?.MetaTitle && content.properties?.Title) {
      warnings.push({
        field: 'properties.SeoSettings.MetaTitle',
        message: 'MetaTitle is empty. Consider setting it for better SEO.',
        suggestion: content.properties.Title
      });
    }

    if (!content.properties?.SeoSettings?.MetaDescription) {
      warnings.push({
        field: 'properties.SeoSettings.MetaDescription',
        message: 'MetaDescription is empty. This is important for SEO.',
        suggestion: 'Add a 150-160 character description'
      });
    }

    return {
      ...result,
      warnings
    };
  }
}