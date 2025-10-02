import { z } from 'zod';
import { BaseTool, ToolContext } from '../base-tool.js';
import { getGraphConfig, getCMAConfig } from '../../config.js';
import { SchemaDiscoveryService } from '../../services/schema-discovery.js';
import { SchemaFieldDiscovery } from '../../logic/content/schema-field-discovery.js';
import { executeContentTypeDiscovery, executeSmartContentTypeMatch } from '../../logic/types/smart-discovery.js';
import { SchemaIntrospector } from '../../logic/graph/schema-introspector.js';
import { getDiscoveryCache, withDiscoveryCache } from '../../services/discovery-cache.js';
import type { ContentTypeInfo, FieldInfo, SchemaInfo } from '../../types/discovery.js';

// Input schema for the discovery tool
const discoverSchema = z.object({
  target: z.enum(['types', 'fields', 'schema', 'all']).describe('What to discover'),
  contentType: z.string().optional().describe('Content type name (required for fields/schema targets)'),
  includeMetadata: z.boolean().optional().default(true).describe('Include metadata information'),
  includeExamples: z.boolean().optional().default(false).describe('Include example values'),
  useCache: z.boolean().optional().default(true).describe('Use cached data if available')
});

type DiscoverInput = z.infer<typeof discoverSchema>;

// Types are now imported from discovery.ts

interface DiscoverOutput {
  target: string;
  timestamp: string;
  cached: boolean;
  data: {
    types?: ContentTypeInfo[];
    fields?: FieldInfo[];
    schema?: SchemaInfo;
    summary?: {
      totalTypes?: number;
      abstractTypes?: number;
      concreteTypes?: number;
      totalFields?: number;
      searchableFields?: number;
    };
  };
}

export class DiscoverTool extends BaseTool<DiscoverInput, DiscoverOutput> {
  protected readonly name = 'discover';
  protected readonly description = `Discover content types, fields, and schema information from Optimizely CMS.

🚀 ALWAYS USE THIS FIRST before searching or querying content!

Quick examples:
- List all content types: discover({"target": "types"})
- Get fields for a type: discover({"target": "fields", "contentType": "ArticlePage"})
- Get complete schema: discover({"target": "schema", "contentType": "ArticlePage"})
- Discover everything: discover({"target": "all"})

This tool helps you understand what content and fields are available in the CMS.`;
  protected readonly inputSchema = discoverSchema;
  
  private schemaService: SchemaDiscoveryService | null = null;
  private introspector: SchemaIntrospector | null = null;
  private discoveryCache = getDiscoveryCache();
  
  protected async run(input: DiscoverInput, context: ToolContext): Promise<DiscoverOutput> {
    const { config } = context;
    const startTime = Date.now();
    
    // Initialize services if needed
    await this.initializeServices(config);
    
    let result: DiscoverOutput = {
      target: input.target,
      timestamp: new Date().toISOString(),
      cached: false,
      data: {}
    };
    
    // Use discovery cache if enabled
    if (input.useCache) {
      result.data = await this.performCachedDiscovery(input, config);
      result.cached = true;
    } else {
      const discovered = await this.performDiscovery(input, config);
      result.data = discovered.data;
      result.cached = false;
    }
    
    // Add summary if discovering all
    if (input.target === 'all') {
      result.data.summary = this.generateSummary(result.data);
    }
    
    const duration = Date.now() - startTime;
    this.logger.info(`Discovery completed in ${duration}ms`, { 
      target: input.target,
      cached: result.cached 
    });
    
    return result;
  }
  
  private async initializeServices(config: any): Promise<void> {
    if (!this.schemaService) {
      const graphConfig = getGraphConfig(config);
      this.schemaService = new SchemaDiscoveryService(graphConfig);
      await this.schemaService.initialize();
    }
    
    if (!this.introspector) {
      const graphConfig = getGraphConfig(config);
      this.introspector = new SchemaIntrospector(graphConfig);
    }
  }
  
  private async performCachedDiscovery(input: DiscoverInput, config: any): Promise<DiscoverOutput['data']> {
    switch (input.target) {
      case 'types': {
        // Try cache first
        const cached = await this.discoveryCache.getCachedTypes();
        if (cached) {
          this.logger.debug('Using cached content types');
          return { types: cached.data };
        }
        
        // Perform discovery and cache
        const types = await this.discoverTypes(config, input);
        await this.discoveryCache.cacheTypes(types);
        return { types };
      }
      
      case 'fields': {
        if (!input.contentType) {
          throw new Error('contentType is required when target is "fields"');
        }
        
        // Try cache first
        const cached = await this.discoveryCache.getCachedFields(input.contentType);
        if (cached) {
          this.logger.debug(`Using cached fields for ${input.contentType}`);
          return { fields: cached.data };
        }
        
        // Perform discovery and cache
        const fields = await this.discoverFields(config, input.contentType, input);
        await this.discoveryCache.cacheFields(input.contentType, fields);
        return { fields };
      }
      
      case 'schema': {
        if (!input.contentType) {
          throw new Error('contentType is required when target is "schema"');
        }
        
        // Try cache first
        const cached = await this.discoveryCache.getCachedSchema(input.contentType);
        if (cached) {
          this.logger.debug(`Using cached schema for ${input.contentType}`);
          return { schema: cached.data };
        }
        
        // Perform discovery and cache
        const schema = await this.discoverSchema(config, input.contentType, input);
        await this.discoveryCache.cacheSchema(input.contentType, schema);
        return { schema };
      }
      
      case 'all': {
        // For 'all', we combine cached and fresh data progressively
        const data: DiscoverOutput['data'] = {};
        
        // Get types (potentially from cache)
        const typesCached = await this.discoveryCache.getCachedTypes();
        if (typesCached) {
          data.types = typesCached.data;
          this.logger.debug('Using cached content types for "all" discovery');
        } else {
          data.types = await this.discoverTypes(config, input);
          await this.discoveryCache.cacheTypes(data.types);
        }
        
        // Get fields for concrete types
        const allFields: FieldInfo[] = [];
        const typeCount = data.types.length;
        
        for (let i = 0; i < typeCount; i++) {
          const type = data.types[i];
          if (!type.isAbstract) {
            // Try cache first for each type
            const fieldsCached = await this.discoveryCache.getCachedFields(type.name);
            if (fieldsCached) {
              allFields.push(...fieldsCached.data);
            } else {
              const fields = await this.discoverFields(config, type.name, input);
              await this.discoveryCache.cacheFields(type.name, fields);
              allFields.push(...fields);
            }
          }
          this.reportProgress(`Processing ${i + 1}/${typeCount} types...`, 33 + (33 * (i + 1) / typeCount));
        }
        
        data.fields = allFields;
        return data;
      }
      
      default:
        throw new Error(`Unknown discovery target: ${input.target}`);
    }
  }
  
  private async performDiscovery(input: DiscoverInput, config: any): Promise<DiscoverOutput> {
    const result: DiscoverOutput = {
      target: input.target,
      timestamp: new Date().toISOString(),
      cached: false,
      data: {}
    };
    
    switch (input.target) {
      case 'types':
        this.reportProgress('Discovering content types...', 0);
        result.data.types = await this.discoverTypes(config, input);
        this.reportProgress('Content type discovery complete', 100);
        break;
        
      case 'fields':
        if (!input.contentType) {
          throw new Error('contentType is required when target is "fields"');
        }
        this.reportProgress(`Discovering fields for ${input.contentType}...`, 0);
        result.data.fields = await this.discoverFields(config, input.contentType, input);
        this.reportProgress('Field discovery complete', 100);
        break;
        
      case 'schema':
        if (!input.contentType) {
          throw new Error('contentType is required when target is "schema"');
        }
        this.reportProgress(`Discovering schema for ${input.contentType}...`, 0);
        result.data.schema = await this.discoverSchema(config, input.contentType, input);
        this.reportProgress('Schema discovery complete', 100);
        break;
        
      case 'all':
        this.reportProgress('Discovering all content types and schemas...', 0);
        
        // Discover types first
        result.data.types = await this.discoverTypes(config, input);
        this.reportProgress('Content types discovered', 33);
        
        // Then discover fields for each type
        const allFields: FieldInfo[] = [];
        const typeCount = result.data.types.length;
        for (let i = 0; i < typeCount; i++) {
          const type = result.data.types[i];
          if (!type.isAbstract) {
            const fields = await this.discoverFields(config, type.name, input);
            allFields.push(...fields);
          }
          this.reportProgress(`Processing ${i + 1}/${typeCount} types...`, 33 + (33 * (i + 1) / typeCount));
        }
        result.data.fields = allFields;
        
        this.reportProgress('Discovery complete', 100);
        break;
    }
    
    return result;
  }
  
  private async discoverTypes(config: any, options: DiscoverInput): Promise<ContentTypeInfo[]> {
    // Use GraphQL introspection for fast discovery
    const contentTypes = await this.introspector!.getContentTypes();
    
    // If detailed metadata is needed, enhance with CMA data
    if (options.includeMetadata) {
      const cmaConfig = getCMAConfig(config);
      const cmaDiscovery = await executeContentTypeDiscovery(cmaConfig, {
        includeDescriptions: true
      });
      
      // Merge GraphQL and CMA data
      return contentTypes.map(graphType => {
        const cmaType = cmaDiscovery.content.find(t => 
          t.name === graphType.name || t.displayName === graphType.name
        );
        
        return {
          name: graphType.name,
          displayName: cmaType?.displayName || graphType.displayName,
          description: cmaType?.description || graphType.description,
          category: cmaType?.category || this.categorizeType(graphType.name),
          isAbstract: graphType.isAbstract,
          baseType: graphType.baseType,
          interfaces: graphType.interfaces
        };
      });
    }
    
    return contentTypes;
  }
  
  private async discoverFields(config: any, contentType: string, options: DiscoverInput): Promise<FieldInfo[]> {
    // Try GraphQL first for speed
    const graphFields = await this.schemaService!.getContentTypeFields(contentType);
    
    // If we need detailed field info, use CMA
    if (options.includeMetadata || options.includeExamples) {
      try {
        const cmaConfig = getCMAConfig(config);
        const fieldDiscovery = new SchemaFieldDiscovery();
        const schema = await fieldDiscovery.getContentTypeSchema(cmaConfig, contentType);
        
        if (schema && Array.isArray(schema.properties)) {
          return schema.properties.map(prop => ({
            name: prop.name,
            type: prop.type,
            required: prop.required || false,
            description: prop.description,
            searchable: this.isSearchableField(prop),
            localizable: prop.localized || false,
            allowedTypes: prop.allowedTypes,
            validationRules: prop.format ? [prop.format] : []
          }));
        }
      } catch (error) {
        // Fall back to GraphQL data if CMA fails
        this.logger.warn('CMA field discovery failed, using GraphQL data', { error });
      }
    }
    
    // Convert GraphQL fields to our format
    return graphFields.map(field => ({
      name: field.name,
      type: field.type,
      required: !field.type.includes('null'),
      searchable: field.type.includes('String')
    }));
  }
  
  private async discoverSchema(config: any, contentType: string, options: DiscoverInput): Promise<SchemaInfo> {
    const fields = await this.discoverFields(config, contentType, options);
    
    // Analyze the schema for metadata
    const metadata = this.analyzeMetadata(fields);
    
    // Check for composition support
    const composition = await this.analyzeComposition(config, contentType);
    
    return {
      contentType,
      fields,
      metadata,
      composition
    };
  }
  
  private categorizeType(typeName: string): string {
    const lower = typeName.toLowerCase();
    
    if (lower.includes('page')) return 'Pages';
    if (lower.includes('block')) return 'Blocks';
    if (lower.includes('media') || lower.includes('image') || lower.includes('video')) return 'Media';
    if (lower.includes('folder') || lower.includes('container')) return 'Containers';
    if (lower.includes('settings') || lower.includes('config')) return 'Settings';
    
    return 'Other';
  }
  
  private isSearchableField(field: any): boolean {
    const searchableTypes = ['string', 'text', 'richtext', 'html'];
    return searchableTypes.includes(field.type.toLowerCase()) ||
           field.format?.includes('text') ||
           field.searchable === true;
  }
  
  private analyzeMetadata(fields: FieldInfo[]): SchemaInfo['metadata'] {
    const fieldNames = fields.map(f => f.name.toLowerCase());
    
    return {
      hasUrl: fieldNames.some(n => n.includes('url') || n.includes('route')),
      hasNavigation: fieldNames.some(n => n.includes('nav') || n.includes('menu')),
      hasVersions: fieldNames.some(n => n.includes('version')),
      hasSeo: fieldNames.some(n => n.includes('seo') || n.includes('meta'))
    };
  }
  
  private async analyzeComposition(config: any, contentType: string): Promise<SchemaInfo['composition']> {
    const fields = await this.schemaService!.getContentTypeFields(contentType);
    
    const hasContentAreas = fields.some(f => 
      f.type.includes('ContentArea') || 
      f.name.toLowerCase().includes('contentarea') ||
      f.name.toLowerCase().includes('mainbody')
    );
    
    return {
      supportsContentAreas: hasContentAreas,
      allowedTypes: [] // Would need deeper introspection to determine
    };
  }
  
  private generateSummary(data: DiscoverOutput['data']): DiscoverOutput['data']['summary'] {
    const types = data.types || [];
    const fields = data.fields || [];
    
    return {
      totalTypes: types.length,
      abstractTypes: types.filter(t => t.isAbstract).length,
      concreteTypes: types.filter(t => !t.isAbstract).length,
      totalFields: fields.length,
      searchableFields: fields.filter(f => f.searchable).length
    };
  }
}