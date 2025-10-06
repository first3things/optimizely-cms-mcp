import { z } from 'zod';
import { BaseTool } from '../base-tool.js';
import type { ToolContext } from '../../types/tools.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { SchemaIntrospector } from '../../logic/graph/schema-introspector.js';
import { DiscoveryCache } from '../../services/discovery-cache.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Unified Get Tool - One tool to get content by ANY identifier
 *
 * This is the new recommended way to retrieve content from Optimizely CMS.
 * It intelligently handles:
 * - Search terms ("Article 4")
 * - URL paths ("/article-4/")
 * - Content keys (f3e8ef7f63ac45758a1dca8fbbde8d82)
 * - GUIDs (f3e8ef7f-63ac-4575-8a1d-ca8fbbde8d82)
 *
 * The tool:
 * 1. Auto-detects identifier type
 * 2. Finds the content using optimal strategy
 * 3. Discovers fields for the content type
 * 4. Returns complete content with all fields
 *
 * Replaces the old 3-step workflow: search → locate → retrieve
 */
export class GetTool extends BaseTool<GetInput, GetOutput> {
  protected readonly name = 'get';
  protected readonly description = `Get complete content by ANY identifier - search term, URL, key, or GUID.

This unified tool intelligently finds and returns content in ONE call:

Examples:
- By search: get({"identifier": "Article 4"})
- By URL: get({"identifier": "/article-4/"})
- By key: get({"identifier": "f3e8ef7f63ac45758a1dca8fbbde8d82"})
- By GUID: get({"identifier": "f3e8ef7f-63ac-4575-8a1d-ca8fbbde8d82"})

The tool auto-discovers fields and returns complete content including:
- All metadata (_metadata)
- All discovered content fields (Heading, Body, etc.)
- Resolved blocks/nested content (if enabled)
- Content type schema (if requested)

This replaces the old search → locate → retrieve workflow with a single call.`;

  protected readonly inputSchema = z.object({
    identifier: z.string().min(1).describe('Search term, URL path, content key, or GUID'),
    identifierType: z.enum(['auto', 'search', 'path', 'key']).default('auto')
      .describe('Type of identifier (auto-detected by default)'),

    // Output control
    includeFields: z.array(z.string()).optional()
      .describe('Specific fields to include (empty = all discovered fields)'),
    includeMetadata: z.boolean().default(true)
      .describe('Include content metadata'),
    includeSchema: z.boolean().default(false)
      .describe('Include content type schema'),

    // Search options (when identifier is a search term)
    searchLimit: z.number().min(1).max(10).default(1)
      .describe('Max results if searching (1 = return first match)'),

    // Locale and version
    locale: z.string().default('en').describe('Content locale'),
    version: z.string().optional().describe('Specific version to retrieve'),

    // Block resolution
    resolveBlocks: z.boolean().default(true)
      .describe('Resolve block/nested content references'),
    resolveDepth: z.number().min(0).max(5).default(2)
      .describe('Depth for resolving nested content'),

    // Field limits
    maxFields: z.number().min(1).max(100).default(50)
      .describe('Maximum fields to return (prevents query bloat)')
  });

  private introspector: SchemaIntrospector | null = null;
  private discoveryCache: DiscoveryCache | null = null;
  private graphClient: OptimizelyGraphClient | null = null;
  private cmaClient: OptimizelyContentClient | null = null;
  private logger = getLogger();

  async initialize(context: ToolContext): Promise<void> {
    this.graphClient = new OptimizelyGraphClient({
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

    this.cmaClient = new OptimizelyContentClient({
      baseUrl: context.config.cma.baseUrl,
      clientId: context.config.cma.clientId,
      clientSecret: context.config.cma.clientSecret,
      grantType: context.config.cma.grantType,
      tokenEndpoint: context.config.cma.tokenEndpoint,
      impersonateUser: context.config.cma.impersonateUser,
      timeout: context.config.options.timeout,
      maxRetries: context.config.options.maxRetries
    });

    this.introspector = new SchemaIntrospector(this.graphClient);
    this.discoveryCache = new DiscoveryCache(context.config);
  }

  protected async run(input: GetInput, context: ToolContext): Promise<GetOutput> {
    if (!this.graphClient || !this.introspector || !this.discoveryCache || !this.cmaClient) {
      await this.initialize(context);
    }

    try {
      // Step 1: Detect identifier type
      const identifierType = this.detectIdentifierType(input.identifier, input.identifierType);
      this.logger.info(`Identifier type detected: ${identifierType}`, { identifier: input.identifier });

      // Step 2: Find content with fallback strategies
      const foundContent = await this.findContentWithFallback(
        input.identifier,
        identifierType,
        input.locale,
        input.searchLimit
      );

      if (!foundContent) {
        throw new NotFoundError(`Content not found: ${input.identifier}`);
      }

      // Step 3: Get complete content with discovered fields
      const enrichResult = await this.enrichWithFields(
        foundContent.key,
        foundContent.contentType,
        input.locale,
        input
      );

      // Step 4: Build output
      const output: GetOutput = {
        content: enrichResult.content,
        discovery: {
          method: foundContent.method,
          contentType: foundContent.contentType,
          fieldsDiscovered: enrichResult.fieldsDiscovered,
          identifierUsed: input.identifier,
          identifierType: identifierType
        }
      };

      // Add optional data
      if (foundContent.score !== undefined) {
        output.discovery.searchScore = foundContent.score;
      }

      if (foundContent.alternatives && foundContent.alternatives.length > 0) {
        output.discovery.alternatives = foundContent.alternatives;
      }

      if (input.includeSchema) {
        output.schema = await this.getContentTypeSchema(foundContent.contentType);
      }

      return output;

    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }
      throw new Error(`Failed to get content: ${error.message}`);
    }
  }

  /**
   * Detect the type of identifier provided
   */
  private detectIdentifierType(identifier: string, hint: string): string {
    if (hint !== 'auto') {
      return hint;
    }

    const normalized = identifier.trim();

    // URL path (starts with /)
    if (normalized.startsWith('/')) {
      return 'path';
    }

    // Key pattern - 32 hex chars (with or without hyphens)
    const keyPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
    const simpleKeyPattern = /^[0-9a-f]{32}$/i;

    if (keyPattern.test(normalized) || simpleKeyPattern.test(normalized)) {
      return 'key';
    }

    // Numeric ID pattern
    if (/^\d+$/.test(normalized)) {
      return 'key';
    }

    // Default to search for everything else
    return 'search';
  }

  /**
   * Find content using multiple strategies with fallback
   */
  private async findContentWithFallback(
    identifier: string,
    identifierType: string,
    locale: string,
    searchLimit: number
  ): Promise<FoundContent | null> {
    // Define strategy chain
    const strategies = [
      // Primary strategy based on detected type
      { type: identifierType, priority: 1 },
      // Fallback strategies
      ...(identifierType !== 'search' ? [{ type: 'search', priority: 2 }] : []),
      ...(identifierType !== 'key' ? [{ type: 'key', priority: 3 }] : [])
    ];

    // Try each strategy
    for (const strategy of strategies) {
      try {
        this.logger.debug(`Trying strategy: ${strategy.type}`, { priority: strategy.priority });
        const result = await this.findContent(identifier, strategy.type, locale, searchLimit);

        if (result) {
          this.logger.info(`Content found using strategy: ${strategy.type}`);
          return result;
        }
      } catch (error) {
        this.logger.warn(`Strategy ${strategy.type} failed, trying next...`, { error: error.message });
      }
    }

    return null;
  }

  /**
   * Find content using a specific strategy
   */
  private async findContent(
    identifier: string,
    strategy: string,
    locale: string,
    searchLimit: number
  ): Promise<FoundContent | null> {
    switch (strategy) {
      case 'search':
        return await this.findBySearch(identifier, locale, searchLimit);
      case 'path':
        return await this.findByPath(identifier, locale);
      case 'key':
        return await this.findByKey(identifier, locale);
      default:
        throw new Error(`Unknown strategy: ${strategy}`);
    }
  }

  /**
   * Find content by search term
   */
  private async findBySearch(
    query: string,
    locale: string,
    limit: number
  ): Promise<FoundContent | null> {
    const graphQuery = `
      query SearchContent($query: String!, $locale: [Locales!], $limit: Int!) {
        _Content(
          locale: $locale,
          limit: $limit,
          where: { _fulltext: { match: $query } }
        ) {
          total
          items {
            _metadata {
              key
              displayName
              types
              url { default }
            }
            _type: __typename
            _score
          }
        }
      }
    `;

    const result = await this.graphClient!.query(graphQuery, {
      query,
      locale: [locale],
      limit: limit + 5 // Get a few extra for alternatives
    });

    const items = result._Content?.items || [];
    if (items.length === 0) {
      return null;
    }

    const primary = items[0];
    const alternatives = items.slice(1, limit + 1).map((item: any) => ({
      key: item._metadata.key,
      displayName: item._metadata.displayName,
      contentType: item._type,
      url: item._metadata.url?.default,
      score: item._score
    }));

    // Use the most specific type (first in types array) instead of generic __typename
    // e.g., "ArticlePage" instead of "_Page"
    const specificType = primary._metadata.types && primary._metadata.types.length > 0
      ? primary._metadata.types[0]
      : primary._type;

    return {
      key: primary._metadata.key,
      contentType: specificType,
      method: 'search',
      score: primary._score,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      fieldsDiscovered: [] // Will be filled later
    };
  }

  /**
   * Find content by URL path (FIXED to handle multiple URL field variations)
   */
  private async findByPath(
    path: string,
    locale: string
  ): Promise<FoundContent | null> {
    // Try multiple URL field variations to handle different Graph API versions
    const graphQuery = `
      query LocateByPath($path: String!, $locale: [Locales!]) {
        _Content(
          locale: $locale,
          where: {
            _or: [
              { _metadata: { url: { default: { eq: $path } } } }
              { _metadata: { url: { hierarchical: { eq: $path } } } }
            ]
          },
          limit: 1
        ) {
          items {
            _metadata {
              key
              displayName
              types
              url { default }
            }
            _type: __typename
          }
        }
      }
    `;

    const result = await this.graphClient!.query(graphQuery, {
      path,
      locale: [locale]
    });

    const items = result._Content?.items || [];
    if (items.length === 0) {
      return null;
    }

    const item = items[0];
    // Use the most specific type (first in types array)
    const specificType = item._metadata.types && item._metadata.types.length > 0
      ? item._metadata.types[0]
      : item._type;

    return {
      key: item._metadata.key,
      contentType: specificType,
      method: 'locate-path',
      fieldsDiscovered: []
    };
  }

  /**
   * Find content by key/GUID
   */
  private async findByKey(
    identifier: string,
    locale: string
  ): Promise<FoundContent | null> {
    // Normalize key (remove hyphens if GUID format)
    const key = identifier.replace(/-/g, '');

    const graphQuery = `
      query LocateByKey($key: String!, $locale: [Locales!]) {
        _Content(
          locale: $locale,
          where: { _metadata: { key: { eq: $key } } },
          limit: 1
        ) {
          items {
            _metadata {
              key
              displayName
              types
              url { default }
            }
            _type: __typename
          }
        }
      }
    `;

    const result = await this.graphClient!.query(graphQuery, {
      key,
      locale: [locale]
    });

    const items = result._Content?.items || [];
    if (items.length === 0) {
      return null;
    }

    const item = items[0];
    // Use the most specific type (first in types array)
    const specificType = item._metadata.types && item._metadata.types.length > 0
      ? item._metadata.types[0]
      : item._type;

    return {
      key: item._metadata.key,
      contentType: specificType,
      method: 'locate-key',
      fieldsDiscovered: []
    };
  }

  /**
   * Enrich found content with discovered fields
   */
  private async enrichWithFields(
    key: string,
    contentType: string,
    locale: string,
    options: GetInput
  ): Promise<{ content: any; fieldsDiscovered: string[] }> {
    // Step 1: Discover fields for the SPECIFIC content type (e.g., ArticlePage)
    const fields = await this.discoverFields(contentType);

    if (fields.length === 0) {
      this.logger.warn(`No fields discovered for ${contentType}, trying queryable interface`);
      // Fallback to queryable interface if specific type has no fields
      const queryableType = await this.getQueryableType(contentType);
      const queryableFields = await this.discoverFields(queryableType);
      if (queryableFields.length > 0) {
        this.logger.info(`Using ${queryableFields.length} fields from queryable type ${queryableType}`);
        return await this.queryWithFields(key, queryableType, queryableType, locale, queryableFields, options);
      }
      throw new NotFoundError(`No fields discovered for ${contentType} or its queryable interfaces`);
    }

    this.logger.debug(`Discovered ${fields.length} fields for ${contentType}`);

    // Step 2: Dynamically discover which queryable type to use
    const queryableType = await this.getQueryableType(contentType);
    const needsInlineFragment = contentType !== queryableType;

    if (needsInlineFragment) {
      this.logger.debug(`Using inline fragment: querying ${queryableType} with fields from ${contentType}`);
      return await this.queryWithFields(key, queryableType, contentType, locale, fields, options);
    } else {
      return await this.queryWithFields(key, contentType, contentType, locale, fields, options);
    }
  }

  /**
   * Execute a query with discovered fields
   * @param queryType - The GraphQL type to query (e.g., _Page, _Block)
   * @param specificType - The specific content type for inline fragment (e.g., ArticlePage)
   */
  private async queryWithFields(
    key: string,
    queryType: string,
    specificType: string,
    locale: string,
    fields: FieldInfo[],
    options: GetInput
  ): Promise<{ content: any; fieldsDiscovered: string[] }> {
    // Filter fields based on options
    const fieldsToQuery = this.selectFields(fields, options);

    // Build dynamic query with inline fragment support
    const query = this.buildDynamicQuery(
      queryType,
      specificType,
      key,
      locale,
      fieldsToQuery,
      options
    );

    this.logger.debug(`Querying ${queryType}${specificType !== queryType ? ` (... on ${specificType})` : ''} with ${fieldsToQuery.length} fields`);

    // Execute query
    const result = await this.graphClient!.query(query, {
      key,
      locale: [locale]
    });

    // Extract and format content
    const items = result[queryType]?.items || [];
    if (items.length === 0) {
      throw new NotFoundError(`Content found but fields could not be retrieved: ${key}`);
    }

    // Return both content and the list of fields we discovered
    return {
      content: items[0],
      fieldsDiscovered: fieldsToQuery.map(f => f.name)
    };
  }

  /**
   * Get queryable type for a content type by discovering from schema
   * Uses GraphQL introspection to find which queryable interface the type implements
   * NO HARDCODED MAPPINGS - fully dynamic discovery
   */
  private async getQueryableType(contentType: string): Promise<string> {
    // Step 1: Check if this type is directly queryable
    const queryFields = await this.introspector!.getQueryFields();
    const isDirectlyQueryable = queryFields.some(f => f.name === contentType);

    if (isDirectlyQueryable) {
      this.logger.debug(`${contentType} is directly queryable`);
      return contentType;
    }

    // Step 2: Get the interfaces this type implements
    const typeInfo = await this.introspector!.getContentType(contentType);
    if (!typeInfo || !typeInfo.interfaces || typeInfo.interfaces.length === 0) {
      this.logger.warn(`No interfaces found for ${contentType}, defaulting to _Content`);
      return '_Content';
    }

    this.logger.debug(`${contentType} implements: ${typeInfo.interfaces.join(', ')}`);

    // Step 3: Find which interface is queryable
    for (const interfaceName of typeInfo.interfaces) {
      const isQueryable = queryFields.some(f => f.name === interfaceName);
      if (isQueryable) {
        this.logger.debug(`Found queryable interface: ${interfaceName}`);
        return interfaceName;
      }
    }

    // Step 4: Fallback - try to find any Content-related queryable field
    const contentQueryField = await this.introspector!.findContentQueryField();
    if (contentQueryField) {
      this.logger.debug(`Using fallback content query field: ${contentQueryField}`);
      return contentQueryField;
    }

    // Last resort
    this.logger.warn(`Could not find queryable type for ${contentType}, using _Content`);
    return '_Content';
  }

  /**
   * Discover fields for a content type using Graph introspection ONLY
   * No CMA fallback - fully Graph-based discovery
   */
  private async discoverFields(contentType: string): Promise<FieldInfo[]> {
    // Try cache first
    const cached = await this.discoveryCache!.getCachedFields(contentType);
    if (cached && cached.data) {
      this.logger.debug(`Using cached fields for ${contentType}: ${cached.data.length} fields`);
      return cached.data;
    }

    // Use Graph introspection to discover fields
    const typeInfo = await this.introspector!.getContentType(contentType);
    if (!typeInfo || !typeInfo.fields || typeInfo.fields.length === 0) {
      this.logger.debug(`No fields found via Graph introspection for ${contentType}`);
      return [];
    }

    this.logger.debug(`Found ${typeInfo.fields.length} fields via Graph introspection for ${contentType}`);

    return typeInfo.fields.map(f => ({
      name: f.name,
      type: f.type,
      searchable: typeInfo.searchableFields.includes(f.name),
      required: f.isRequired
    }));
  }

  /**
   * Select which fields to include in query
   */
  private selectFields(allFields: FieldInfo[], options: GetInput): FieldInfo[] {
    let selectedFields = allFields;

    // If specific fields requested, filter to those
    if (options.includeFields && options.includeFields.length > 0) {
      selectedFields = allFields.filter(f =>
        options.includeFields!.includes(f.name)
      );
    }

    // Filter to basic queryable fields (no complex nested types)
    selectedFields = selectedFields.filter(f => this.isBasicField(f));

    // Apply max fields limit
    if (selectedFields.length > options.maxFields) {
      // Prioritize: metadata fields, then searchable, then rest
      const metadata = selectedFields.filter(f => f.name.startsWith('_'));
      const searchable = selectedFields.filter(f => f.searchable && !f.name.startsWith('_'));
      const rest = selectedFields.filter(f => !f.searchable && !f.name.startsWith('_'));

      selectedFields = [
        ...metadata,
        ...searchable.slice(0, Math.floor(options.maxFields * 0.7)),
        ...rest.slice(0, Math.floor(options.maxFields * 0.3))
      ].slice(0, options.maxFields);
    }

    return selectedFields;
  }

  /**
   * Check if a field is a basic queryable type
   */
  private isBasicField(field: FieldInfo): boolean {
    const type = field.type.toLowerCase();

    // Include basic scalar types
    if (type.includes('string') ||
        type.includes('int') ||
        type.includes('float') ||
        type.includes('boolean') ||
        type.includes('date')) {
      return true;
    }

    // Include rich text (works well)
    if (type.includes('richtext')) {
      return true;
    }

    // TEMPORARY: Skip ContentReference and ContentArea until we figure out correct syntax
    // if (type.includes('contentreference') || type.includes('contentarea')) {
    //   return true;
    // }

    return false;
  }

  /**
   * Build dynamic GraphQL query based on discovered fields
   * Supports inline fragments for querying specific types via base interfaces
   */
  private buildDynamicQuery(
    queryType: string,
    specificType: string,
    key: string,
    locale: string,
    fields: FieldInfo[],
    options: GetInput
  ): string {
    const parts: string[] = [];
    const useInlineFragment = queryType !== specificType;

    // Query header
    parts.push('query GetContent($key: String!, $locale: [Locales!]) {');
    parts.push(`  ${queryType}(`);
    parts.push('    where: { _metadata: { key: { eq: $key } } },');
    parts.push('    locale: $locale,');
    parts.push('    limit: 1');
    parts.push('  ) {');
    parts.push('    items {');

    // Always include metadata if requested
    if (options.includeMetadata) {
      parts.push('      _metadata {');
      parts.push('        key');
      parts.push('        displayName');
      parts.push('        version');
      parts.push('        status');
      parts.push('        locale');
      parts.push('        url { default internal hierarchical }');
      parts.push('        published');
      parts.push('        lastModified');
      parts.push('        created');
      parts.push('        types');
      parts.push('      }');
      parts.push('      _type: __typename');
    }

    // If using inline fragment, wrap specific fields
    if (useInlineFragment) {
      parts.push(`      ... on ${specificType} {`);
    }

    // Add discovered fields
    for (const field of fields) {
      if (field.name.startsWith('_')) continue; // Skip metadata fields (already added)

      const indent = useInlineFragment ? '        ' : '      ';
      parts.push(`${indent}${field.name}${this.getFieldProjection(field, options)}`);
    }

    // Close inline fragment if used
    if (useInlineFragment) {
      parts.push('      }');
    }

    parts.push('    }');
    parts.push('  }');
    parts.push('}');

    return parts.join('\n');
  }

  /**
   * Get field projection (for nested types like RichText)
   */
  private getFieldProjection(field: FieldInfo, options: GetInput): string {
    const type = field.type.toLowerCase();

    // Rich text fields - always get both html and json
    if (type.includes('richtext')) {
      return ' { html json }';
    }

    // Content references - skip projection for now (Graph API syntax varies)
    // These fields will return basic reference data without nested projection
    if (type.includes('contentreference')) {
      return ''; // Let Graph API return default fields
    }

    // Content areas - skip projection for now
    if (type.includes('contentarea')) {
      return ''; // Let Graph API return default fields
    }

    // Default: no projection
    return '';
  }

  /**
   * Get content type schema
   */
  private async getContentTypeSchema(contentType: string): Promise<any> {
    const cached = await this.discoveryCache!.getCachedSchema(contentType);
    if (cached && cached.data) {
      return cached.data;
    }

    const typeInfo = await this.introspector!.getContentType(contentType);
    return {
      name: typeInfo?.name,
      fields: typeInfo?.fields || [],
      interfaces: typeInfo?.interfaces || []
    };
  }
}

// Type definitions
interface GetInput {
  identifier: string;
  identifierType: 'auto' | 'search' | 'path' | 'key';
  includeFields?: string[];
  includeMetadata: boolean;
  includeSchema: boolean;
  searchLimit: number;
  locale: string;
  version?: string;
  resolveBlocks: boolean;
  resolveDepth: number;
  maxFields: number;
}

interface GetOutput {
  content: any;
  discovery: {
    method: string;
    contentType: string;
    fieldsDiscovered: string[];
    identifierUsed: string;
    identifierType: string;
    searchScore?: number;
    alternatives?: Array<{
      key: string;
      displayName: string;
      contentType: string;
      url?: string;
      score?: number;
    }>;
  };
  schema?: any;
}

interface FoundContent {
  key: string;
  contentType: string;
  method: string;
  score?: number;
  alternatives?: Array<{
    key: string;
    displayName: string;
    contentType: string;
    url?: string;
    score?: number;
  }>;
  fieldsDiscovered: string[];
}

interface FieldInfo {
  name: string;
  type: string;
  searchable?: boolean;
  required?: boolean;
}
