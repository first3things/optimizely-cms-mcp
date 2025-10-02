/**
 * Intelligent Field Populator
 * Automatically populates required fields based on CMS schema and context
 */

import { CMSAdapter, ContentTypeSchema, PropertyDefinition } from '../../adapters/base.js';
import { getLogger } from '../../utils/logger.js';
import { withCache } from '../../utils/cache.js';
import { getPatternLearner } from './pattern-learner.js';

interface PopulationContext {
  contentType: string;
  displayName: string;
  properties?: Record<string, any>;
  container?: string;
  locale?: string;
}

interface PopulationResult {
  populatedProperties: Record<string, any>;
  missingRequired: string[];
  suggestions: Array<{
    field: string;
    message: string;
    suggestedValue?: any;
  }>;
}

export class IntelligentFieldPopulator {
  private logger = getLogger();
  private patternLearner = getPatternLearner();
  
  constructor(private adapter: CMSAdapter) {}

  /**
   * Intelligently populate required fields for content creation
   */
  async populateRequiredFields(context: PopulationContext): Promise<PopulationResult> {
    this.logger.info('IntelligentFieldPopulator.populateRequiredFields called', {
      contentType: context.contentType,
      providedProperties: context.properties,
      propertyKeys: Object.keys(context.properties || {}),
      propertyCount: Object.keys(context.properties || {}).length
    });
    
    // Get schema for the content type
    const schema = await this.getSchemaWithCache(context.contentType);
    
    // Start with provided properties
    const populatedProperties = { ...(context.properties || {}) };
    const missingRequired: string[] = [];
    const suggestions: PopulationResult['suggestions'] = [];
    
    // Pre-initialize nested objects for required fields
    const requiredFields = Array.isArray(schema.required) ? schema.required : [];
    for (const requiredField of requiredFields) {
      if (requiredField.includes('.')) {
        // This is a nested field, ensure parent objects exist
        const parts = requiredField.split('.');
        let current = populatedProperties;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!current[part] || typeof current[part] !== 'object') {
            current[part] = {};
            this.logger.debug(`Initialized nested object for required field: ${parts.slice(0, i + 1).join('.')}`);
          }
          current = current[part];
        }
      }
    }
    
    // Process each required field - ensure schema.required is an array
    for (const requiredField of requiredFields) {
      const fieldValue = this.getFieldValue(populatedProperties, requiredField);
      
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        // Try to populate the field intelligently
        const populated = await this.populateField(
          requiredField,
          schema,
          context,
          populatedProperties
        );
        
        if (populated.value !== undefined) {
          this.setFieldValue(populatedProperties, requiredField, populated.value);
          
          if (populated.wasGenerated) {
            suggestions.push({
              field: requiredField,
              message: populated.message || `Auto-populated ${requiredField}`,
              suggestedValue: populated.value
            });
          }
        } else {
          missingRequired.push(requiredField);
          
          // Get suggestions for the missing field
          const suggestedValues = await this.adapter.getSuggestedValues(
            requiredField,
            context.contentType,
            populatedProperties
          );
          
          if (suggestedValues.length > 0) {
            suggestions.push({
              field: requiredField,
              message: `Required field is missing. Suggested values: ${suggestedValues.slice(0, 3).join(', ')}`,
              suggestedValue: suggestedValues[0]
            });
          }
        }
      }
    }
    
    // Check for recommended fields that are missing
    await this.checkRecommendedFields(schema, populatedProperties, context, suggestions);
    
    return {
      populatedProperties,
      missingRequired,
      suggestions
    };
  }

  /**
   * Populate a single field intelligently
   */
  private async populateField(
    fieldPath: string,
    schema: ContentTypeSchema,
    context: PopulationContext,
    currentProperties: Record<string, any>
  ): Promise<{ value?: any; wasGenerated: boolean; message?: string }> {
    const property = Array.isArray(schema.properties) 
      ? schema.properties.find(p => p.path === fieldPath)
      : undefined;
    if (!property) {
      return { wasGenerated: false };
    }
    
    // First, check if we have learned patterns for this field
    const learnedValue = await this.patternLearner.getMostLikelyValue(
      context.contentType,
      fieldPath,
      context
    );
    
    if (learnedValue !== undefined) {
      return {
        value: learnedValue,
        wasGenerated: true,
        message: `Using learned pattern for ${fieldPath}`
      };
    }
    
    // Check if we have a default value in the schema
    const defaultValue = schema.defaults?.[fieldPath];
    if (defaultValue !== undefined) {
      return {
        value: defaultValue,
        wasGenerated: true,
        message: `Using schema default for ${fieldPath}`
      };
    }
    
    // Try to generate based on field characteristics
    const generated = await this.generateFieldValue(property, context, currentProperties);
    if (generated !== undefined) {
      return {
        value: generated,
        wasGenerated: true,
        message: `Generated value for ${fieldPath}`
      };
    }
    
    return { wasGenerated: false };
  }

  /**
   * Generate a value for a field based on its characteristics
   */
  private async generateFieldValue(
    property: PropertyDefinition,
    context: PopulationContext,
    currentProperties: Record<string, any>
  ): Promise<any> {
    const lowerPath = property.path.toLowerCase();
    const lowerName = property.name.toLowerCase();
    
    // Route segment generation
    if (lowerName === 'routesegment' || lowerPath.includes('routesegment')) {
      return this.generateRouteSegment(context.displayName);
    }
    
    // Title fields
    if (lowerPath.includes('title') && !lowerPath.includes('meta')) {
      return context.displayName;
    }
    
    // Meta title generation
    if (lowerPath.includes('metatitle') || lowerPath.includes('seotitle')) {
      const mainTitle = currentProperties.Title || context.displayName;
      return this.generateMetaTitle(mainTitle);
    }
    
    // Meta description generation
    if (lowerPath.includes('metadescription') || lowerPath.includes('seodescription')) {
      const mainTitle = currentProperties.Title || context.displayName;
      return this.generateMetaDescription(mainTitle, context.contentType);
    }
    
    // GraphType field (OpenGraph Type)
    if (lowerPath.includes('graphtype') || lowerPath.includes('ogtype') || lowerPath.includes('opengraphtype')) {
      return this.generateGraphType(context.contentType);
    }
    
    // URL fields
    if (property.type === 'url' && lowerPath.includes('canonical')) {
      return ''; // Will be auto-generated by CMS
    }
    
    // Status fields
    if (lowerName === 'status' || lowerPath.includes('status')) {
      return 'draft';
    }
    
    // Language/locale fields
    if (lowerName === 'locale' || lowerName === 'language') {
      return context.locale || 'en';
    }
    
    // Let adapter handle CMS-specific fields
    const adapterSuggestions = await this.adapter.getSuggestedValues(
      property.path,
      context.contentType,
      currentProperties
    );
    
    if (adapterSuggestions.length > 0) {
      // Use the first suggestion as the default
      return adapterSuggestions[0];
    }
    
    return undefined;
  }

  /**
   * Generate a URL-friendly route segment from a display name
   */
  private generateRouteSegment(displayName: string): string {
    return displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100); // Limit length
  }

  /**
   * Generate an SEO-friendly meta title
   */
  private generateMetaTitle(mainTitle: string): string {
    // Keep it under 60 characters for SEO
    if (mainTitle.length <= 60) {
      return mainTitle;
    }
    
    // Truncate at word boundary
    const truncated = mainTitle.substring(0, 57);
    const lastSpace = truncated.lastIndexOf(' ');
    return truncated.substring(0, lastSpace) + '...';
  }

  /**
   * Generate a basic meta description
   */
  private generateMetaDescription(title: string, contentType: string): string {
    const typeLabel = this.getContentTypeLabel(contentType);
    return `${typeLabel} about ${title}. Read more to learn about this topic.`;
  }

  /**
   * Get a human-readable label for content type
   */
  private getContentTypeLabel(contentType: string): string {
    const lower = contentType.toLowerCase();
    
    if (lower.includes('article')) return 'Article';
    if (lower.includes('blog')) return 'Blog post';
    if (lower.includes('news')) return 'News article';
    if (lower.includes('product')) return 'Product page';
    if (lower.includes('landing')) return 'Landing page';
    
    return 'Page';
  }

  /**
   * Generate appropriate OpenGraph type based on content type
   */
  private generateGraphType(contentType: string): string {
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
   * Check for recommended fields that should be populated
   */
  private async checkRecommendedFields(
    schema: ContentTypeSchema,
    properties: Record<string, any>,
    context: PopulationContext,
    suggestions: PopulationResult['suggestions']
  ): Promise<void> {
    // Check for SEO-related fields dynamically
    const seoPatterns = [
      { pattern: /metatitle|seotitle/i, recommendation: 'Add a meta title for better SEO' },
      { pattern: /metadescription|seodescription/i, recommendation: 'Add a meta description for search results' },
      { pattern: /metakeywords|seokeywords/i, recommendation: 'Consider adding relevant keywords' }
    ];
    
    // Find SEO fields dynamically based on patterns
    if (Array.isArray(schema.properties)) {
      for (const property of schema.properties) {
        const lowerPath = property.path.toLowerCase();
        for (const seoField of seoPatterns) {
          if (seoField.pattern.test(lowerPath) && !this.getFieldValue(properties, property.path)) {
            suggestions.push({
              field: property.path,
              message: seoField.recommendation
            });
            break; // Only add one suggestion per field
          }
        }
      }
    }
  }

  /**
   * Get schema with caching
   */
  private async getSchemaWithCache(contentType: string): Promise<ContentTypeSchema> {
    return withCache(
      `schema:intelligent:${contentType}`,
      () => this.adapter.getContentTypeSchema(contentType),
      600 // Cache for 10 minutes
    );
  }

  /**
   * Get field value from nested object using dot notation
   */
  private getFieldValue(obj: any, path: string): any {
    return path.split('.').reduce((curr, prop) => curr?.[prop], obj);
  }

  /**
   * Set field value in nested object using dot notation
   */
  private setFieldValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((curr, key) => {
      if (!curr[key]) curr[key] = {};
      return curr[key];
    }, obj);
    target[lastKey] = value;
  }

  /**
   * Validate and transform content before submission
   */
  async validateAndTransform(
    content: any,
    contentType: string,
    operation: 'create' | 'update'
  ): Promise<{
    valid: boolean;
    transformed: any;
    errors: string[];
    warnings: string[];
  }> {
    // Get schema
    const schema = await this.getSchemaWithCache(contentType);
    
    // Validate content
    const validationResult = await this.adapter.validateContent(content, schema);
    
    // Transform content for CMS
    const transformed = await this.adapter.transformContent(content, contentType, operation);
    
    return {
      valid: validationResult.valid,
      transformed,
      errors: validationResult.errors.map(e => e.message),
      warnings: validationResult.warnings?.map(w => w.message) || []
    };
  }
  
  /**
   * Record successful content creation for learning
   */
  async recordSuccess(
    contentType: string,
    properties: Record<string, any>,
    context?: Record<string, any>
  ): Promise<void> {
    this.logger.debug('Recording successful content creation for learning');
    await this.patternLearner.learnFromSuccess(contentType, properties, context);
  }
}