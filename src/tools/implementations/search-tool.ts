import { z } from 'zod';
import { BaseTool } from '../base-tool.js';
import type { ToolContext } from '../../types/tools.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { SchemaIntrospector } from '../../logic/graph/schema-introspector.js';
import { DiscoveryCache } from '../../services/discovery-cache.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Search tool - Find content using Graph API with intelligent querying
 * 
 * This tool provides powerful search capabilities:
 * - Full-text search across all content
 * - Type-specific search
 * - Field-specific search
 * - Metadata search (paths, status, etc.)
 * - Faceted search with aggregations
 * 
 * The tool automatically discovers available searchable fields
 * and builds optimized GraphQL queries based on the schema.
 */
export class SearchTool extends BaseTool<SearchInput, SearchOutput> {
  protected readonly name = 'search';
  protected readonly description = `Search for content using Graph API with intelligent query building.

IMPORTANT: Use 'discover' tool FIRST to find available content types and fields.

Example workflow:
1. discover({"target": "types"}) - Find content types
2. discover({"target": "fields", "contentType": "ArticlePage"}) - Find fields
3. search({"query": "mcp", "contentTypes": ["ArticlePage"]}) - Search content

This tool automatically builds optimal GraphQL queries based on discovered schema.`;
  
  protected readonly inputSchema = z.object({
    query: z.string().optional().describe('Search query text'),
    contentTypes: z.array(z.string()).optional().describe('Filter by content type names'),
    filters: z.record(z.any()).optional().describe('Field-specific filters'),
    locale: z.string().default('en').describe('Content locale'),
    limit: z.number().min(1).max(100).default(20).describe('Maximum results to return'),
    offset: z.number().min(0).default(0).describe('Pagination offset'),
    orderBy: z.object({
      field: z.string(),
      direction: z.enum(['ASC', 'DESC']).default('DESC')
    }).optional().describe('Sort order'),
    includeFacets: z.boolean().default(false).describe('Include search facets/aggregations'),
    includeTotal: z.boolean().default(true).describe('Include total count'),
    searchMode: z.enum(['content', 'metadata', 'all']).default('all').describe('Search scope')
  });

  private introspector: SchemaIntrospector | null = null;
  private discoveryCache: DiscoveryCache | null = null;
  private logger = getLogger();

  async initialize(context: ToolContext): Promise<void> {
    const graphClient = new OptimizelyGraphClient({
      endpoint: context.config.graph.endpoint,
      auth: {
        method: context.config.graph.authMethod,
        singleKey: context.config.graph.credentials.singleKey,
        appKey: context.config.graph.credentials.appKey,
        secret: context.config.graph.credentials.secret,
        username: context.config.graph.credentials.username,
        password: context.config.graph.credentials.password,
        token: context.config.graph.credentials.token
      },
      timeout: context.config.options.timeout,
      maxRetries: context.config.options.maxRetries
    });

    this.introspector = new SchemaIntrospector(graphClient);
    this.discoveryCache = new DiscoveryCache(context.config);
  }

  protected async run(input: SearchInput, context: ToolContext): Promise<SearchOutput> {
    if (!this.introspector || !this.discoveryCache) {
      await this.initialize(context);
    }

    try {
      // Build the search query
      const query = await this.buildSearchQuery(input);
      const variables = this.buildVariables(input);

      // Execute the search
      const graphClient = new OptimizelyGraphClient({
        endpoint: context.config.graph.endpoint,
        auth: {
          method: context.config.graph.authMethod,
          singleKey: context.config.graph.credentials.singleKey,
          appKey: context.config.graph.credentials.appKey,
          secret: context.config.graph.credentials.secret,
          username: context.config.graph.credentials.username,
          password: context.config.graph.credentials.password,
          token: context.config.graph.credentials.token
        },
        timeout: context.config.options.timeout,
        maxRetries: context.config.options.maxRetries
      });

      const result = await graphClient.query(query, variables);

      // Process and format results
      return this.processSearchResults(result, input);
    } catch (error) {
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  private async buildSearchQuery(input: SearchInput): Promise<string> {
    const parts: string[] = [];

    // Query header
    parts.push('query ContentSearch(');
    parts.push('  $locale: [Locales!],');
    if (input.query) parts.push('  $searchText: String,');
    parts.push('  $limit: Int!,');
    parts.push('  $skip: Int!');
    parts.push(') {');

    // Main search query
    parts.push('  _Content(');
    parts.push('    locale: $locale,');
    parts.push('    limit: $limit,');
    parts.push('    skip: $skip,');
    
    // Add where clause
    const whereClause = await this.buildWhereClause(input);
    if (whereClause) {
      parts.push(`    where: ${whereClause},`);
    }

    // Add order by
    if (input.orderBy) {
      parts.push(`    orderBy: { ${await this.mapOrderByField(input.orderBy.field)}: ${input.orderBy.direction} },`);
    }

    parts.push('  ) {');

    // Add total count if requested
    if (input.includeTotal) {
      parts.push('    total');
    }

    // Add items with fields
    parts.push('    items {');
    parts.push('      _metadata {');
    parts.push('        key');
    parts.push('        version');
    parts.push('        locale');
    parts.push('        displayName');
    parts.push('        status');
    parts.push('        url {');
    parts.push('          default');
    parts.push('          internal');
    parts.push('        }');
    parts.push('        published');
    parts.push('        lastModified');
    parts.push('      }');
    parts.push('      _type: __typename');
    
    // Add searchable fields based on content type
    if (input.searchMode !== 'metadata') {
      const searchableFields = await this.getSearchableFields(input.contentTypes);
      parts.push(searchableFields);
    }

    parts.push('    }');

    // Add facets if requested
    if (input.includeFacets) {
      parts.push('    facets {');
      parts.push('      _type {');
      parts.push('        name');
      parts.push('        count');
      parts.push('      }');
      parts.push('      _metadata {');
      parts.push('        status {');
      parts.push('          name');
      parts.push('          count');
      parts.push('        }');
      parts.push('      }');
      parts.push('    }');
    }

    parts.push('  }');
    parts.push('}');

    return parts.join('\n');
  }

  private async buildWhereClause(input: SearchInput): Promise<string | null> {
    const conditions: string[] = [];

    // Full-text search
    if (input.query) {
      conditions.push(`_fulltext: { match: $searchText }`);
    }

    // Content type filter
    if (input.contentTypes && input.contentTypes.length > 0) {
      const typeConditions = input.contentTypes.map(type => `_metadata: { types: { eq: "${type}" } }`);
      if (typeConditions.length === 1) {
        conditions.push(typeConditions[0]);
      } else {
        conditions.push(`_or: [${typeConditions.map(tc => `{ ${tc} }`).join(', ')}]`);
      }
    }

    // Custom filters
    if (input.filters) {
      for (const [field, value] of Object.entries(input.filters)) {
        const mappedField = await this.mapFilterField(field);
        conditions.push(this.buildFilterCondition(mappedField, value));
      }
    }

    if (conditions.length === 0) return null;
    if (conditions.length === 1) return `{ ${conditions[0]} }`;
    return `{ _and: [${conditions.map(c => `{ ${c} }`).join(', ')}] }`;
  }

  private buildFilterCondition(field: string, value: any): string {
    if (value === null) {
      return `${field}: { eq: null }`;
    }

    if (typeof value === 'string') {
      return `${field}: { eq: "${value}" }`;
    }

    if (typeof value === 'number') {
      return `${field}: { eq: ${value} }`;
    }

    if (typeof value === 'boolean') {
      return `${field}: { eq: ${value} }`;
    }

    if (Array.isArray(value)) {
      const values = value.map(v => typeof v === 'string' ? `"${v}"` : v).join(', ');
      return `${field}: { in: [${values}] }`;
    }

    if (typeof value === 'object') {
      // Handle range queries
      const parts: string[] = [];
      if ('gt' in value) parts.push(`gt: ${value.gt}`);
      if ('gte' in value) parts.push(`gte: ${value.gte}`);
      if ('lt' in value) parts.push(`lt: ${value.lt}`);
      if ('lte' in value) parts.push(`lte: ${value.lte}`);
      if ('contains' in value) parts.push(`contains: "${value.contains}"`);
      if ('startsWith' in value) parts.push(`startsWith: "${value.startsWith}"`);
      
      return `${field}: { ${parts.join(', ')} }`;
    }

    return `${field}: { eq: "${value}" }`;
  }

  private async getSearchableFields(contentTypes?: string[]): Promise<string> {
    if (!contentTypes || contentTypes.length === 0) {
      // Return common fields for all types
      return `
      ... on _IContent {
        _score
      }`;
    }

    // Get fields for specific content types
    const fieldsByType: Map<string, string[]> = new Map();
    
    for (const typeName of contentTypes) {
      try {
        // Try to get from cache first
        const cached = await this.discoveryCache!.getCachedFields(typeName);
        if (cached && cached.data) {
          const searchableFields = cached.data
            .filter(f => f.searchable && this.isBasicField(f))
            .map(f => f.name)
            .slice(0, 10); // Limit to prevent query bloat
          
          if (searchableFields.length > 0) {
            fieldsByType.set(typeName, searchableFields);
          }
        } else if (this.introspector) {
          // Fall back to introspector if not cached
          const contentType = await this.introspector.getContentType(typeName);
          if (contentType) {
            const searchableFields = contentType.searchableFields
              .filter(name => this.isBasicFieldName(name))
              .slice(0, 10);
            
            if (searchableFields.length > 0) {
              fieldsByType.set(typeName, searchableFields);
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Could not get fields for type ${typeName}`, error);
      }
    }

    // Build fragments for each type
    const fragments: string[] = [];
    for (const [typeName, fields] of fieldsByType) {
      fragments.push(`
      ... on ${typeName} {
        ${fields.join('\n        ')}
      }`);
    }

    return fragments.join('');
  }

  private isBasicFieldName(fieldName: string): boolean {
    // Filter out complex fields by name patterns
    return !fieldName.includes('_') || fieldName === '_score';
  }

  private isBasicField(field: any): boolean {
    const type = field.type?.toLowerCase() || '';
    return type.includes('string') || 
           type.includes('int') || 
           type.includes('float') || 
           type.includes('boolean') ||
           type.includes('datetime');
  }

  private async mapFilterField(field: string): Promise<string> {
    // Handle common field mappings
    const commonMappings: Record<string, string> = {
      'id': '_metadata.key',
      'key': '_metadata.key',
      'name': '_metadata.displayName',
      'displayName': '_metadata.displayName',
      'status': '_metadata.status',
      'published': '_metadata.published',
      'modified': '_metadata.lastModified',
      'lastModified': '_metadata.lastModified',
      'type': '_metadata.types',
      'contentType': '_metadata.types',
      'url': '_metadata.url.default',
      'path': '_metadata.url.default'
    };

    return commonMappings[field] || field;
  }

  private async mapOrderByField(field: string): Promise<string> {
    const orderByMappings: Record<string, string> = {
      'name': '_metadata.displayName',
      'displayName': '_metadata.displayName',
      'created': '_metadata.created',
      'modified': '_metadata.lastModified',
      'lastModified': '_metadata.lastModified',
      'published': '_metadata.published',
      'score': '_score',
      'relevance': '_score'
    };

    return orderByMappings[field] || `_metadata.${field}`;
  }

  private buildVariables(input: SearchInput): Record<string, any> {
    const variables: Record<string, any> = {
      locale: [input.locale],
      limit: input.limit,
      skip: input.offset
    };

    if (input.query) {
      variables.searchText = input.query;
    }

    return variables;
  }

  private processSearchResults(result: any, input: SearchInput): SearchOutput {
    const items = result._Content?.items || [];
    const total = result._Content?.total ?? items.length;
    const facets = result._Content?.facets;

    const results: SearchResult[] = items.map((item: any) => ({
      id: item._metadata.key,
      type: item._type,
      displayName: item._metadata.displayName,
      status: item._metadata.status,
      url: item._metadata.url?.default,
      locale: item._metadata.locale,
      published: item._metadata.published,
      lastModified: item._metadata.lastModified,
      score: item._score,
      highlight: this.extractHighlight(item, input.query),
      fields: this.extractFields(item)
    }));

    const output: SearchOutput = {
      results,
      total,
      limit: input.limit,
      offset: input.offset,
      hasMore: total > input.offset + input.limit,
      searchTime: Date.now() // Would be better to track actual time
    };

    if (facets) {
      output.facets = this.processFacets(facets);
    }

    return output;
  }

  private extractHighlight(item: any, query?: string): string | undefined {
    if (!query) return undefined;
    
    // Try to find the query text in various fields
    const fieldsToCheck = [
      item._metadata.displayName,
      item.name,
      item.title,
      item.description,
      item.content
    ];

    for (const field of fieldsToCheck) {
      if (field && typeof field === 'string') {
        const lowerField = field.toLowerCase();
        const lowerQuery = query.toLowerCase();
        
        if (lowerField.includes(lowerQuery)) {
          // Extract context around the match
          const index = lowerField.indexOf(lowerQuery);
          const start = Math.max(0, index - 50);
          const end = Math.min(field.length, index + query.length + 50);
          
          let highlight = field.substring(start, end);
          if (start > 0) highlight = '...' + highlight;
          if (end < field.length) highlight = highlight + '...';
          
          return highlight;
        }
      }
    }

    return undefined;
  }

  private extractFields(item: any): Record<string, any> {
    const fields: Record<string, any> = {};
    
    // Extract non-metadata fields
    for (const [key, value] of Object.entries(item)) {
      if (!key.startsWith('_')) {
        fields[key] = value;
      }
    }
    
    return fields;
  }

  private processFacets(facets: any): SearchFacets {
    const processed: SearchFacets = {};

    if (facets._type) {
      processed.contentTypes = facets._type.map((f: any) => ({
        name: f.name,
        count: f.count
      }));
    }

    if (facets._metadata?.status) {
      processed.status = facets._metadata.status.map((f: any) => ({
        name: f.name,
        count: f.count
      }));
    }

    return processed;
  }
}

// Type definitions
interface SearchInput {
  query?: string;
  contentTypes?: string[];
  filters?: Record<string, any>;
  locale: string;
  limit: number;
  offset: number;
  orderBy?: {
    field: string;
    direction: 'ASC' | 'DESC';
  };
  includeFacets: boolean;
  includeTotal: boolean;
  searchMode: 'content' | 'metadata' | 'all';
}

interface SearchOutput {
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  searchTime: number;
  facets?: SearchFacets;
}

interface SearchResult {
  id: string;
  type: string;
  displayName: string;
  status: string;
  url?: string;
  locale: string;
  published?: string;
  lastModified: string;
  score?: number;
  highlight?: string;
  fields: Record<string, any>;
}

interface SearchFacets {
  contentTypes?: Array<{ name: string; count: number }>;
  status?: Array<{ name: string; count: number }>;
  [key: string]: Array<{ name: string; count: number }> | undefined;
}