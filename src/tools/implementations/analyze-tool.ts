import { z } from 'zod';
import { BaseTool, ToolContext } from '../base-tool.js';
import { getCMAConfig } from '../../config.js';
import { AdapterRegistry } from '../../adapters/registry.js';
import { SchemaFieldDiscovery } from '../../logic/content/schema-field-discovery.js';
import { IntelligentContentPopulator } from '../../logic/content/intelligent-populator.js';
import { ContentTypeSchema, PropertyInfo } from '../../types/content.js';
import { ValidationError } from '../../utils/errors.js';

// Input schema for the analyze tool
const analyzeSchema = z.object({
  contentType: z.string().min(1).describe('The content type to analyze'),
  includeExamples: z.boolean().optional().default(true).describe('Include example values for fields'),
  includeInherited: z.boolean().optional().default(true).describe('Include inherited properties from base types'),
  includeValidation: z.boolean().optional().default(true).describe('Include validation rules'),
  generateDefaults: z.boolean().optional().default(true).describe('Generate smart default values')
});

type AnalyzeInput = z.infer<typeof analyzeSchema>;

interface FieldAnalysis {
  name: string;
  path: string;
  type: string;
  required: boolean;
  description?: string;
  category: 'metadata' | 'content' | 'seo' | 'navigation' | 'settings' | 'other';
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    allowedValues?: any[];
  };
  defaultValue?: any;
  exampleValue?: any;
  searchable?: boolean;
  localizable?: boolean;
  inherited?: boolean;
  mappingSuggestions?: string[];
}

interface ContentTypeAnalysis {
  contentType: string;
  displayName?: string;
  description?: string;
  baseType?: string;
  isPage: boolean;
  isBlock: boolean;
  isMedia: boolean;
  fields: FieldAnalysis[];
  requiredFields: string[];
  searchableFields: string[];
  localizableFields: string[];
  fieldCategories: Record<string, string[]>;
  recommendations: string[];
  warnings: string[];
  examples: {
    minimal: Record<string, any>;
    complete: Record<string, any>;
  };
}

export class AnalyzeTool extends BaseTool<AnalyzeInput, ContentTypeAnalysis> {
  protected readonly name = 'analyze';
  protected readonly description = 'Analyze content type requirements and generate examples';
  protected readonly inputSchema = analyzeSchema;
  
  protected async run(input: AnalyzeInput, context: ToolContext): Promise<ContentTypeAnalysis> {
    const { config } = context;
    
    this.reportProgress(`Analyzing content type: ${input.contentType}`, 0);
    
    // Get CMS adapter
    const registry = AdapterRegistry.getInstance();
    const adapter = registry.getOptimizelyAdapter(getCMAConfig(config));
    
    // Get content type schema
    const schema = await this.getContentTypeSchema(adapter, input.contentType);
    this.reportProgress('Schema retrieved', 20);
    
    // Analyze fields
    const fieldAnalyses = await this.analyzeFields(schema, input, config);
    this.reportProgress('Fields analyzed', 40);
    
    // Categorize fields
    const categories = this.categorizeFields(fieldAnalyses);
    this.reportProgress('Fields categorized', 60);
    
    // Generate examples
    const examples = await this.generateExamples(schema, fieldAnalyses, input, config);
    this.reportProgress('Examples generated', 80);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(fieldAnalyses, schema);
    const warnings = this.generateWarnings(fieldAnalyses, schema);
    
    this.reportProgress('Analysis complete', 100);
    
    return {
      contentType: schema.key,
      displayName: schema.displayName,
      description: schema.description,
      baseType: schema.baseType,
      isPage: this.isPageType(schema),
      isBlock: this.isBlockType(schema),
      isMedia: this.isMediaType(schema),
      fields: fieldAnalyses,
      requiredFields: fieldAnalyses.filter(f => f.required).map(f => f.path),
      searchableFields: fieldAnalyses.filter(f => f.searchable).map(f => f.path),
      localizableFields: fieldAnalyses.filter(f => f.localizable).map(f => f.path),
      fieldCategories: categories,
      recommendations,
      warnings,
      examples
    };
  }
  
  private async getContentTypeSchema(adapter: any, contentType: string): Promise<ContentTypeSchema> {
    try {
      const schema = await adapter.getContentTypeSchema(contentType);
      
      if (!schema) {
        throw new ValidationError(`Content type '${contentType}' not found`);
      }
      
      // Ensure schema has required structure
      if (!schema.properties) {
        schema.properties = [];
      } else if (!Array.isArray(schema.properties)) {
        schema.properties = Object.values(schema.properties);
      }
      
      return schema;
    } catch (error: any) {
      if (error.statusCode === 404) {
        throw new ValidationError(`Content type '${contentType}' does not exist`);
      }
      throw error;
    }
  }
  
  private async analyzeFields(
    schema: ContentTypeSchema,
    input: AnalyzeInput,
    config: any
  ): Promise<FieldAnalysis[]> {
    const analyses: FieldAnalysis[] = [];
    const populator = new IntelligentContentPopulator();
    
    for (const property of schema.properties) {
      if (!property || typeof property !== 'object') continue;
      
      const analysis: FieldAnalysis = {
        name: property.name,
        path: property.path || property.name,
        type: property.type,
        required: property.required || false,
        description: property.description,
        category: this.categorizeField(property),
        searchable: this.isSearchable(property),
        localizable: property.localized || false,
        inherited: property.inherited || false,
        mappingSuggestions: this.getMappingSuggestions(property)
      };
      
      // Add validation rules if requested
      if (input.includeValidation) {
        analysis.validation = this.extractValidation(property);
      }
      
      // Generate default value if requested
      if (input.generateDefaults) {
        analysis.defaultValue = await this.generateDefaultValue(property, schema, populator, config);
      }
      
      // Generate example value if requested
      if (input.includeExamples) {
        analysis.exampleValue = await this.generateExampleValue(property, schema, populator, config);
      }
      
      analyses.push(analysis);
    }
    
    // Sort by category and then by name
    return analyses.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });
  }
  
  private categorizeField(property: PropertyInfo): FieldAnalysis['category'] {
    const name = property.name.toLowerCase();
    const path = (property.path || '').toLowerCase();
    
    // Metadata fields
    if (name.includes('metadata') || name === 'key' || name === 'guid' || 
        name === 'contenttype') {
      return 'metadata';
    }
    
    // SEO fields
    if (path.includes('seo') || name.includes('meta') || 
        name.includes('opengraph') || name.includes('ogimage')) {
      return 'seo';
    }
    
    // Navigation fields
    if (name.includes('navigation') || name.includes('menu') || 
        name.includes('breadcrumb')) {
      return 'navigation';
    }
    
    // Settings fields
    if (name.includes('settings') || name.includes('config') || 
        name === 'status' || name === 'locale') {
      return 'settings';
    }
    
    // Content fields
    if (name.includes('body') || name.includes('content') || 
        name.includes('text') || name.includes('title') || 
        name.includes('heading') || name.includes('description')) {
      return 'content';
    }
    
    return 'other';
  }
  
  private isSearchable(property: PropertyInfo): boolean {
    const textTypes = ['string', 'text', 'richtext', 'html', 'markdown'];
    return textTypes.includes(property.type.toLowerCase()) ||
           property.searchable === true;
  }
  
  private getMappingSuggestions(property: PropertyInfo): string[] {
    const suggestions: string[] = [property.name];
    const lower = property.name.toLowerCase();
    
    // Add common variations
    if (lower === 'title') {
      suggestions.push('heading', 'name', 'displayName', 'headline');
    } else if (lower === 'body' || lower === 'mainbody') {
      suggestions.push('content', 'text', 'description', 'richText');
    } else if (lower.includes('image')) {
      suggestions.push('photo', 'picture', 'media', 'asset');
    } else if (lower.includes('url')) {
      suggestions.push('link', 'href', 'path', 'route');
    }
    
    return [...new Set(suggestions)];
  }
  
  private extractValidation(property: PropertyInfo): FieldAnalysis['validation'] {
    const validation: FieldAnalysis['validation'] = {};
    
    if (property.format) {
      validation.format = property.format;
      
      // Extract constraints from format
      if (property.format.includes('min:')) {
        const match = property.format.match(/min:(\d+)/);
        if (match) validation.minLength = parseInt(match[1]);
      }
      if (property.format.includes('max:')) {
        const match = property.format.match(/max:(\d+)/);
        if (match) validation.maxLength = parseInt(match[1]);
      }
    }
    
    if (property.pattern) {
      validation.pattern = property.pattern;
    }
    
    if (property.allowedTypes?.length) {
      validation.allowedValues = property.allowedTypes;
    }
    
    return Object.keys(validation).length > 0 ? validation : undefined;
  }
  
  private async generateDefaultValue(
    property: PropertyInfo,
    schema: ContentTypeSchema,
    populator: IntelligentContentPopulator,
    config: any
  ): Promise<any> {
    // Use the intelligent populator to generate defaults
    const context = {
      contentType: schema.key,
      displayName: 'Example',
      locale: 'en'
    };
    
    return populator.generateDefaultValue(property, context, {});
  }
  
  private async generateExampleValue(
    property: PropertyInfo,
    schema: ContentTypeSchema,
    populator: IntelligentContentPopulator,
    config: any
  ): Promise<any> {
    // Generate more realistic example values
    const name = property.name.toLowerCase();
    const type = property.type.toLowerCase();
    
    // Special handling for known field types
    if (name === 'title' || name === 'heading') {
      return 'Example Page Title';
    } else if (name === 'description' || name.includes('description')) {
      return 'This is an example description that provides context about the content.';
    } else if (type === 'boolean') {
      return true;
    } else if (type === 'number' || type === 'integer') {
      return 42;
    } else if (type === 'array') {
      return [];
    } else if (type === 'contentreference' || type === 'contentarea') {
      return { contentLink: { id: 123, guidValue: '00000000-0000-0000-0000-000000000000' } };
    }
    
    // Fallback to default value
    return this.generateDefaultValue(property, schema, populator, config);
  }
  
  private categorizeFields(fields: FieldAnalysis[]): Record<string, string[]> {
    const categories: Record<string, string[]> = {
      metadata: [],
      content: [],
      seo: [],
      navigation: [],
      settings: [],
      other: []
    };
    
    for (const field of fields) {
      categories[field.category].push(field.path);
    }
    
    // Remove empty categories
    return Object.fromEntries(
      Object.entries(categories).filter(([_, fields]) => fields.length > 0)
    );
  }
  
  private async generateExamples(
    schema: ContentTypeSchema,
    fields: FieldAnalysis[],
    input: AnalyzeInput,
    config: any
  ): Promise<ContentTypeAnalysis['examples']> {
    const minimal: Record<string, any> = {};
    const complete: Record<string, any> = {};
    
    // Minimal example - only required fields
    for (const field of fields.filter(f => f.required)) {
      minimal[field.name] = field.defaultValue || field.exampleValue || `Required ${field.type} field`;
    }
    
    // Complete example - all fields with good examples
    for (const field of fields) {
      complete[field.name] = field.exampleValue || field.defaultValue || `Example ${field.type} value`;
    }
    
    return { minimal, complete };
  }
  
  private generateRecommendations(fields: FieldAnalysis[], schema: ContentTypeSchema): string[] {
    const recommendations: string[] = [];
    
    // Check for SEO fields
    const hasSeoFields = fields.some(f => f.category === 'seo');
    if (!hasSeoFields) {
      recommendations.push('Consider adding SEO metadata fields for better search engine optimization');
    }
    
    // Check for required fields
    const requiredCount = fields.filter(f => f.required).length;
    if (requiredCount === 0) {
      recommendations.push('No required fields detected - consider marking essential fields as required');
    } else if (requiredCount > 10) {
      recommendations.push(`High number of required fields (${requiredCount}) may impact content editor experience`);
    }
    
    // Check for searchable content
    const searchableCount = fields.filter(f => f.searchable).length;
    if (searchableCount === 0) {
      recommendations.push('No searchable fields detected - consider marking text fields as searchable');
    }
    
    // Check for localization
    const localizableCount = fields.filter(f => f.localizable).length;
    if (localizableCount > 0 && localizableCount < fields.length / 2) {
      recommendations.push('Only some fields are localizable - review localization strategy');
    }
    
    return recommendations;
  }
  
  private generateWarnings(fields: FieldAnalysis[], schema: ContentTypeSchema): string[] {
    const warnings: string[] = [];
    
    // Check for missing descriptions
    const undocumented = fields.filter(f => !f.description).length;
    if (undocumented > fields.length / 2) {
      warnings.push(`${undocumented} fields lack descriptions - this may confuse content editors`);
    }
    
    // Check for overly complex structure
    const nestedFields = fields.filter(f => f.path.includes('.')).length;
    if (nestedFields > fields.length / 2) {
      warnings.push('High proportion of nested fields may indicate overly complex structure');
    }
    
    // Check for potential naming conflicts
    const names = fields.map(f => f.name.toLowerCase());
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      warnings.push(`Potential naming conflicts detected: ${[...new Set(duplicates)].join(', ')}`);
    }
    
    return warnings;
  }
  
  private isPageType(schema: ContentTypeSchema): boolean {
    return schema.key.toLowerCase().includes('page') ||
           schema.baseType?.toLowerCase().includes('page') ||
           false;
  }
  
  private isBlockType(schema: ContentTypeSchema): boolean {
    return schema.key.toLowerCase().includes('block') ||
           schema.baseType?.toLowerCase().includes('block') ||
           false;
  }
  
  private isMediaType(schema: ContentTypeSchema): boolean {
    const key = schema.key.toLowerCase();
    return key.includes('media') || key.includes('image') || 
           key.includes('video') || key.includes('file') ||
           schema.baseType?.toLowerCase().includes('media') ||
           false;
  }
}