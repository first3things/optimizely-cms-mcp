/**
 * Base CMS Adapter Interface
 * Defines the contract that all CMS adapters must implement
 * to enable intelligent, pluggable content management
 */

export interface ContentTypeSchema {
  name: string;
  displayName: string;
  baseType: string;
  properties: PropertyDefinition[];
  required: string[];
  defaults: Record<string, any>;
  validation?: ValidationRule[];
}

export interface PropertyDefinition {
  name: string;
  path: string; // Dot notation path e.g., "SeoSettings.GraphType"
  type: PropertyType;
  required: boolean;
  defaultValue?: any;
  allowedValues?: any[];
  description?: string;
  validation?: ValidationRule;
}

export type PropertyType = 
  | 'string' 
  | 'number' 
  | 'boolean' 
  | 'date' 
  | 'object' 
  | 'array' 
  | 'html' 
  | 'url' 
  | 'reference';

export interface ValidationRule {
  type: 'pattern' | 'length' | 'range' | 'enum' | 'custom';
  value: any;
  message?: string;
}

export interface FieldDefault {
  field: string;
  value: any;
  condition?: (contentType: string, properties: any) => boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  requiredType?: string;
  providedType?: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: any;
}

export interface ContentTypeInfo {
  key: string;
  displayName: string;
  description?: string;
  baseType: string;
  category: 'page' | 'block' | 'media' | 'folder' | 'component' | 'other';
  allowedChildren?: string[];
  allowedParents?: string[];
}

/**
 * Base interface for CMS adapters
 * Implement this to add support for different CMS platforms
 */
export interface CMSAdapter {
  readonly name: string;
  readonly version: string;

  /**
   * Get all available content types
   */
  getContentTypes(): Promise<ContentTypeInfo[]>;

  /**
   * Get detailed schema for a specific content type
   */
  getContentTypeSchema(typeName: string): Promise<ContentTypeSchema>;

  /**
   * Get intelligent defaults for a content type
   */
  getFieldDefaults(typeName: string): Promise<FieldDefault[]>;

  /**
   * Validate content against schema
   */
  validateContent(content: any, schema: ContentTypeSchema): Promise<ValidationResult>;

  /**
   * Get suggested values for a field based on context
   */
  getSuggestedValues(
    fieldPath: string, 
    contentType: string, 
    context?: Record<string, any>
  ): Promise<any[]>;

  /**
   * Transform content to match CMS requirements
   */
  transformContent(
    content: any, 
    contentType: string, 
    operation: 'create' | 'update'
  ): Promise<any>;

  /**
   * Check if a field is required in the current context
   */
  isFieldRequired(
    fieldPath: string, 
    contentType: string, 
    context?: Record<string, any>
  ): Promise<boolean>;
}

/**
 * Base adapter class with common functionality
 */
export abstract class BaseCMSAdapter implements CMSAdapter {
  abstract readonly name: string;
  abstract readonly version: string;

  abstract getContentTypes(): Promise<ContentTypeInfo[]>;
  abstract getContentTypeSchema(typeName: string): Promise<ContentTypeSchema>;
  
  /**
   * Default implementation of field defaults
   * Can be overridden by specific adapters
   */
  async getFieldDefaults(typeName: string): Promise<FieldDefault[]> {
    const schema = await this.getContentTypeSchema(typeName);
    const defaults: FieldDefault[] = [];

    // Ensure properties is an array
    if (!Array.isArray(schema.properties)) {
      console.warn(`Schema properties is not an array for type ${typeName}`);
      return defaults;
    }

    // Generate intelligent defaults based on field names and types
    for (const prop of schema.properties) {
      if (prop.defaultValue !== undefined) {
        defaults.push({
          field: prop.path,
          value: prop.defaultValue
        });
      } else {
        const smartDefault = await this.generateSmartDefault(prop, typeName);
        if (smartDefault !== undefined) {
          defaults.push({
            field: prop.path,
            value: smartDefault
          });
        }
      }
    }

    return defaults;
  }

  /**
   * Generate smart defaults based on field characteristics
   */
  protected async generateSmartDefault(
    prop: PropertyDefinition, 
    contentType: string
  ): Promise<any> {
    const fieldName = prop.name.toLowerCase();
    const fieldPath = prop.path.toLowerCase();

    // OpenGraph/SEO related fields
    if (fieldPath.includes('graphtype') || fieldPath.includes('ogtype')) {
      return this.getSmartGraphType(contentType);
    }

    if (fieldPath.includes('metatitle') || fieldPath.includes('ogtitle')) {
      return ''; // Will be populated from main title
    }

    if (fieldPath.includes('metadescription') || fieldPath.includes('ogdescription')) {
      return ''; // Will be populated from main content
    }

    // Boolean fields
    if (prop.type === 'boolean') {
      if (fieldPath.includes('display') || fieldPath.includes('show') || fieldPath.includes('visible')) {
        return true;
      }
      if (fieldPath.includes('hide') || fieldPath.includes('disable')) {
        return false;
      }
    }

    // Date fields
    if (prop.type === 'date') {
      if (fieldPath.includes('publish') || fieldPath.includes('start')) {
        return new Date().toISOString();
      }
    }

    return undefined;
  }

  /**
   * Intelligently determine OpenGraph type based on content type
   */
  protected getSmartGraphType(contentType: string): string {
    const lowerType = contentType.toLowerCase();
    
    // Articles and blog posts
    if (lowerType.match(/article|blog|post|news|story/)) {
      return 'article';
    }
    
    // Video content
    if (lowerType.match(/video|movie|episode|show/)) {
      return 'video.other';
    }
    
    // Product pages
    if (lowerType.match(/product|item|listing|catalog/)) {
      return 'product';
    }
    
    // Profile pages
    if (lowerType.match(/profile|person|author|user/)) {
      return 'profile';
    }
    
    // Books
    if (lowerType.match(/book|publication/)) {
      return 'book';
    }
    
    // Default to website
    return 'website';
  }

  /**
   * Default validation implementation
   */
  async validateContent(
    content: any, 
    schema: ContentTypeSchema
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check required fields - ensure it's an array
    const requiredFields = Array.isArray(schema.required) ? schema.required : [];
    for (const requiredField of requiredFields) {
      const value = this.getFieldValue(content, requiredField);
      if (value === undefined || value === null || value === '') {
        errors.push({
          field: requiredField,
          message: `Field '${requiredField}' is required`
        });
      }
    }

    // Validate field types and constraints
    if (Array.isArray(schema.properties)) {
      for (const prop of schema.properties) {
      const value = this.getFieldValue(content, prop.path);
      if (value !== undefined && value !== null) {
        const typeValidation = this.validateFieldType(value, prop);
        if (!typeValidation.valid) {
          errors.push(...typeValidation.errors);
        }
      }
    }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get field value from nested object using dot notation
   */
  protected getFieldValue(obj: any, path: string): any {
    return path.split('.').reduce((curr, prop) => curr?.[prop], obj);
  }

  /**
   * Set field value in nested object using dot notation
   */
  protected setFieldValue(obj: any, path: string, value: any): any {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((curr, key) => {
      if (!curr[key]) curr[key] = {};
      return curr[key];
    }, obj);
    target[lastKey] = value;
    return obj;
  }

  /**
   * Validate field type
   */
  protected validateFieldType(value: any, prop: PropertyDefinition): ValidationResult {
    const errors: ValidationError[] = [];

    // Type checking
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (prop.type !== 'object' && actualType !== prop.type) {
      errors.push({
        field: prop.path,
        message: `Expected ${prop.type} but got ${actualType}`,
        requiredType: prop.type,
        providedType: actualType
      });
    }

    // Enum validation
    if (prop.allowedValues && !prop.allowedValues.includes(value)) {
      errors.push({
        field: prop.path,
        message: `Value must be one of: ${prop.allowedValues.join(', ')}`
      });
    }

    // Custom validation rules
    if (prop.validation) {
      const ruleResult = this.applyValidationRule(value, prop.validation);
      if (!ruleResult.valid) {
        errors.push({
          field: prop.path,
          message: ruleResult.message || 'Validation failed'
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Apply a validation rule
   */
  protected applyValidationRule(value: any, rule: ValidationRule): { valid: boolean; message?: string } {
    switch (rule.type) {
      case 'pattern':
        const regex = new RegExp(rule.value);
        return {
          valid: regex.test(value),
          message: rule.message || `Value must match pattern: ${rule.value}`
        };

      case 'length':
        const length = value?.length || 0;
        const { min, max } = rule.value;
        const valid = (!min || length >= min) && (!max || length <= max);
        return {
          valid,
          message: rule.message || `Length must be between ${min || 0} and ${max || 'unlimited'}`
        };

      case 'range':
        const num = Number(value);
        const { min: minVal, max: maxVal } = rule.value;
        const isValid = (!minVal || num >= minVal) && (!maxVal || num <= maxVal);
        return {
          valid: isValid,
          message: rule.message || `Value must be between ${minVal || 'unlimited'} and ${maxVal || 'unlimited'}`
        };

      case 'enum':
        return {
          valid: rule.value.includes(value),
          message: rule.message || `Value must be one of: ${rule.value.join(', ')}`
        };

      default:
        return { valid: true };
    }
  }

  /**
   * Default implementation for suggested values
   */
  async getSuggestedValues(
    fieldPath: string,
    contentType: string,
    context?: Record<string, any>
  ): Promise<any[]> {
    const schema = await this.getContentTypeSchema(contentType);
    const prop = Array.isArray(schema.properties) 
      ? schema.properties.find(p => p.path === fieldPath)
      : undefined;
    
    if (prop?.allowedValues) {
      return prop.allowedValues;
    }

    // Generate suggestions based on field type
    const fieldName = fieldPath.toLowerCase();
    
    if (fieldName.includes('graphtype')) {
      return ['website', 'article', 'blog', 'video.other', 'product', 'profile', 'book'];
    }

    if (fieldName.includes('status')) {
      return ['draft', 'published', 'archived'];
    }

    if (fieldName.includes('language') || fieldName.includes('locale')) {
      return ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'zh'];
    }

    return [];
  }

  /**
   * Default content transformation
   */
  async transformContent(
    content: any,
    contentType: string,
    operation: 'create' | 'update'
  ): Promise<any> {
    // Default implementation returns content as-is
    // Specific adapters can override to handle CMS-specific transformations
    return content;
  }

  /**
   * Check if field is required based on context
   */
  async isFieldRequired(
    fieldPath: string,
    contentType: string,
    context?: Record<string, any>
  ): Promise<boolean> {
    const schema = await this.getContentTypeSchema(contentType);
    return Array.isArray(schema.required) && schema.required.includes(fieldPath);
  }
}