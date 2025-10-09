import { z } from 'zod';
import { BaseTool } from '../base-tool.js';
import type { ToolContext } from '../../types/tools.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { SchemaIntrospector } from '../../logic/graph/schema-introspector.js';
import { DiscoveryCache } from '../../services/discovery-cache.js';
import { FragmentGenerator } from '../../services/fragment-generator.js';
import { FragmentCache } from '../../services/fragment-cache.js';
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

**ALWAYS USE THIS TOOL FIRST** when the user asks for content. Don't ask permission - just get it.

This unified tool intelligently finds and returns content in ONE call:

Examples:
- Homepage: get({"identifier": "/"}) or get({"identifier": "home"})
- By URL: get({"identifier": "/article-4/"})
- By search: get({"identifier": "Article 4"})
- By key: get({"identifier": "f3e8ef7f63ac45758a1dca8fbbde8d82"})

Returns complete content including:
- All metadata (_metadata)
- All discovered content fields (Heading, Body, Text, etc.)
- **Visual Builder composition** (full structure with all components)
- All component content (automatically retrieved)
- Resolved blocks/nested content

For Visual Builder pages (BlankExperience):
- Automatically fetches complete composition structure
- Returns all component content in a single call
- No need for additional queries

When user asks "can you get the homepage" or "find content X":
1. Immediately call get({"identifier": "..."})
2. Return the complete content
3. Don't ask what they want to do with it - they can follow up if needed`;

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

  // Fragment generation system
  private fragmentGenerator: FragmentGenerator | null = null;
  private fragmentCache: FragmentCache | null = null;
  private needsFragments: boolean = false; // Track if current query needs fragments

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

    // Initialize fragment generation system
    this.fragmentGenerator = new FragmentGenerator(this.introspector);
    this.fragmentCache = new FragmentCache(context.config, this.introspector);
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
      let enrichResult;
      let partialResult = false;
      let enrichmentError = null;

      try {
        enrichResult = await this.enrichWithFields(
          foundContent.key,
          foundContent.contentType,
          input.locale,
          input
        );
      } catch (enrichError) {
        // Field enrichment failed - return partial result with what we have
        this.logger.error('Field enrichment failed, returning partial result', {
          error: enrichError.message,
          errorStack: enrichError.stack,
          contentKey: foundContent.key,
          contentType: foundContent.contentType
        });

        partialResult = true;
        enrichmentError = enrichError.message;

        // Build minimal content object with metadata we have
        enrichResult = {
          content: {
            _metadata: {
              key: foundContent.key,
              displayName: foundContent.displayName || 'Unknown',
              types: [foundContent.contentType]
            },
            _partial: true,
            _enrichmentError: enrichError.message,
            _helpMessage: `This is a partial result. To get full content, immediately call:\nretrieve({"identifier": "${foundContent.key}", "resolveBlocks": true})`
          },
          fieldsDiscovered: []
        };
      }

      // Step 4: Build output
      const output: GetOutput = {
        content: enrichResult.content,
        discovery: {
          method: foundContent.method,
          contentType: foundContent.contentType,
          fieldsDiscovered: enrichResult.fieldsDiscovered,
          identifierUsed: input.identifier,
          identifierType: identifierType,
          partialResult: partialResult
        }
      };

      // Add enrichment error details if present
      if (enrichmentError) {
        output.discovery.enrichmentError = enrichmentError;
        output.discovery.suggestion = `⚠️ The get tool encountered a GraphQL error (likely a server configuration issue).\n\n` +
          `**NEXT STEP: Use retrieve() instead**\n` +
          `Call: retrieve({"identifier": "${foundContent.key}", "resolveBlocks": true})\n\n` +
          `The retrieve tool uses the Content Management API instead of GraphQL and will return complete content including:\n` +
          `- All content properties\n` +
          `- Visual Builder composition data\n` +
          `- Block/component information\n\n` +
          `DO NOT use graph-query - use retrieve() as shown above.`;
      }

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
    // 🏠 Smart homepage detection - if searching for "home" or "homepage", look for "/" path first
    const isHomepageQuery = /^(home|homepage|start|index)$/i.test(query.trim());

    if (isHomepageQuery) {
      this.logger.info('Homepage keyword detected, searching for "/" path first');
      const homepageResult = await this.findByPath('/', locale);
      if (homepageResult) {
        return homepageResult;
      }
      // If "/" not found, fall through to search
      this.logger.debug('No content at "/", falling back to text search');
    }

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
      displayName: primary._metadata.displayName,
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
      displayName: item._metadata.displayName,
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
      displayName: item._metadata.displayName,
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
    // 🎨 VISUAL BUILDER DETECTION: Check if this is an Experience page
    this.logger.debug(`Getting type info for ${contentType}`);
    let typeInfo;
    try {
      typeInfo = await this.introspector!.getContentType(contentType);
    } catch (introError) {
      this.logger.error('Introspection failed during enrichment', {
        error: introError.message,
        errorDetails: introError,
        contentType
      });
      throw introError;
    }
    const isVisualBuilder = typeInfo?.interfaces?.includes('_IExperience') || false;

    if (isVisualBuilder) {
      this.logger.info(`✨ Visual Builder page detected: ${contentType} - fetching composition`);
      return await this.queryVisualBuilderPage(key, contentType, locale, options);
    }

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
    const query = await this.buildDynamicQuery(
      queryType,
      specificType,
      key,
      locale,
      fieldsToQuery,
      options
    );

    this.logger.debug(`Querying ${queryType}${specificType !== queryType ? ` (... on ${specificType})` : ''} with ${fieldsToQuery.length} fields`);
    this.logger.info(`Generated query length: ${query.length} chars`);

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
   * Query Visual Builder page using _Experience with composition
   */
  private async queryVisualBuilderPage(
    key: string,
    contentType: string,
    locale: string,
    options: GetInput
  ): Promise<{ content: any; fieldsDiscovered: string[] }> {
    // Use simplified query pattern that we know works (tested manually by Claude)
    this.logger.info(`Using simplified Visual Builder query for ${contentType}`);

    const query = `
query GetExperienceComposition {
  ${contentType}(where: { _metadata: { key: { eq: "${key}" } } }) {
    items {
      _metadata {
        key
        displayName
        version
        url { default hierarchical type }
        types
        published
        lastModified
        status
      }
      composition {
        nodes {
          ... on ICompositionStructureNode {
            key
            displayName
            nodes {
              ... on ICompositionStructureNode {
                key
                displayName
                nodes {
                  ... on ICompositionStructureNode {
                    key
                    displayName
                    nodes {
                      ... on ICompositionComponentNode {
                        key
                        displayName
                        component {
                          _metadata {
                            key
                            types
                            displayName
                          }
                        }
                      }
                    }
                  }
                  ... on ICompositionComponentNode {
                    key
                    displayName
                    component {
                      _metadata {
                        key
                        types
                        displayName
                      }
                    }
                  }
                }
              }
              ... on ICompositionComponentNode {
                key
                displayName
                component {
                  _metadata {
                    key
                    types
                    displayName
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`.trim();

    this.logger.debug(`Querying Visual Builder page with simplified query`);

    // Debug: Write query to file for inspection
    const fs = await import('fs');
    fs.writeFileSync('debug-visual-builder-simple-query.graphql', query);
    this.logger.info('Visual Builder query written to debug-visual-builder-simple-query.graphql');

    // Execute query (no variables needed - key is embedded in query)
    let result;
    try {
      result = await this.graphClient!.query(query);
    } catch (error) {
      // Log the full error for debugging
      this.logger.error('Visual Builder query failed', {
        error: error.message,
        errorStack: error.stack,
        contentType,
        key
      });
      throw error;
    }

    // Extract content from content type response (e.g., BlankExperience)
    const items = result[contentType]?.items || [];
    if (items.length === 0) {
      throw new NotFoundError(`Visual Builder content found but could not be retrieved: ${key}`);
    }

    const content = items[0];

    // Flatten composition structure for easier consumption
    const compositionFields = this.extractCompositionFields(content.composition);

    return {
      content: content,
      fieldsDiscovered: ['_metadata', 'composition', ...compositionFields]
    };
  }

  /**
   * Extract field names from composition structure
   */
  private extractCompositionFields(composition: any): string[] {
    if (!composition || !composition.grids) {
      return [];
    }

    const fields = new Set<string>();
    const extractFromNode = (node: any) => {
      if (node.component) {
        Object.keys(node.component).forEach(key => fields.add(key));
      }
      if (node.nodes) {
        node.nodes.forEach(extractFromNode);
      }
      if (node.rows) {
        node.rows.forEach(extractFromNode);
      }
      if (node.columns) {
        node.columns.forEach(extractFromNode);
      }
    };

    composition.grids.forEach(extractFromNode);
    return Array.from(fields);
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

    // Skip GraphQL introspection fields
    if (field.name.startsWith('__')) {
      return false;
    }

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

    // Include Visual Builder composition structures
    if (type.includes('composition')) {
      return true;
    }

    // Include property objects (Settings, Config, etc.)
    if (type.includes('property') ||
        type.includes('settings') ||
        type.includes('config')) {
      return true;
    }

    // TEMPORARY: Skip ContentReference and ContentArea until we figure out correct syntax
    // if (type.includes('contentreference') || type.includes('contentarea')) {
    //   return true;
    // }

    return false;
  }

  /**
   * Check if content type uses Visual Builder composition
   * Only Visual Builder pages need component fragments
   */
  private async hasCompositionField(contentType: string): Promise<boolean> {
    try {
      const fields = await this.discoverFields(contentType);
      return fields.some(f => f.type.toLowerCase().includes('composition'));
    } catch {
      return false;
    }
  }

  /**
   * Get AllComponents fragment (cached or generated)
   * Only called for Visual Builder content types
   */
  private async getAllComponentsFragment(): Promise<string> {
    // Try cache first
    const cached = await this.fragmentCache!.getCachedFragment('AllComponents');
    if (cached) {
      // CRITICAL: Validate cached fragment uses correct projections
      // Old cached fragments may have incorrect fragment names or field patterns
      const hasIncorrectProjections =
        cached.includes('{ key displayName }') ||  // ❌ Wrong ContentReference fields
        cached.includes('{ title text url target }') ||  // ❌ Wrong Link inline projection
        cached.includes('...ContentReference') ||  // ❌ Old fragment name (should be ContentUrl)
        cached.includes('...LinkItemData') ||  // ❌ Old fragment name (should be LinkUrl/LinkCollection)
        cached.includes('fragment ContentReference on') ||  // ❌ Old fragment definition
        cached.includes('fragment LinkItemData on'); // ❌ Old fragment definition

      if (hasIncorrectProjections) {
        this.logger.warn('Cached fragment has incorrect projections, regenerating...');
        await this.fragmentCache!.invalidateCache();
      } else {
        this.logger.debug('Using cached AllComponents fragment');
        return cached;
      }
    }

    // Generate if not cached or cache was invalidated
    this.logger.info('Generating AllComponents fragment (not cached)');
    const generated = await this.fragmentGenerator!.generateAllComponentsFragment();

    // Cache for future use
    await this.fragmentCache!.setCachedFragment('AllComponents', generated.content, {
      componentTypes: generated.componentTypes,
      fragmentCount: generated.componentTypes.length,
      generated: new Date().toISOString()
    });

    return generated.content;
  }

  /**
   * Build Visual Builder query using _Experience with composition
   */
  private async buildVisualBuilderQuery(
    key: string,
    contentType: string,
    locale: string,
    options: GetInput
  ): Promise<string> {
    const parts: string[] = [];

    // Add DisplaySettings fragment (required for displaySettings field)
    parts.push('fragment DisplaySettings on CompositionDisplaySetting {');
    parts.push('  key');
    parts.push('  value');
    parts.push('}');
    parts.push('');

    // Add AllComponents fragment (includes all component field projections)
    const allComponentsFragment = await this.getAllComponentsFragment();
    parts.push(allComponentsFragment);
    parts.push('');

    // Build main query using specific content type (more reliable than _Experience interface)
    parts.push(`query GetExperience($key: String!, $locale: [Locales!]) {`);
    parts.push(`  ${contentType}(`);
    parts.push('    where: { _metadata: { key: { eq: $key } } },');
    parts.push('    locale: $locale,');
    parts.push('    limit: 1');
    parts.push('  ) {');
    parts.push('    items {');
    parts.push('      _metadata {');
    parts.push('        key');
    parts.push('        version');
    parts.push('        url { default hierarchical type }');
    parts.push('        types');
    parts.push('        displayName');
    parts.push('        published');
    parts.push('        lastModified');
    parts.push('        status');
    parts.push('      }');
    parts.push('      composition {');
    parts.push('        grids: nodes {');
    parts.push('          key');
    parts.push('          displayName');
    parts.push('          displayTemplateKey');
    parts.push('          displaySettings { ...DisplaySettings }');
    parts.push('          ... on CompositionStructureNode {');
    parts.push('            nodeType');
    parts.push('            rows: nodes {');
    parts.push('              ... on CompositionStructureNode {');
    parts.push('                nodeType');
    parts.push('                key');
    parts.push('                displayTemplateKey');
    parts.push('                displaySettings { ...DisplaySettings }');
    parts.push('                columns: nodes {');
    parts.push('                  ... on CompositionStructureNode {');
    parts.push('                    nodeType');
    parts.push('                    key');
    parts.push('                    displayTemplateKey');
    parts.push('                    displaySettings { ...DisplaySettings }');
    parts.push('                    nodes {');
    parts.push('                      ... on CompositionComponentNode {');
    parts.push('                        key');
    parts.push('                        displayTemplateKey');
    parts.push('                        displaySettings { ...DisplaySettings }');
    parts.push('                        component {');
    parts.push('                          _metadata { types }');
    parts.push('                          ...AllComponents');
    parts.push('                        }');
    parts.push('                      }');
    parts.push('                    }');
    parts.push('                  }');
    parts.push('                }');
    parts.push('              }');
    parts.push('            }');
    parts.push('          }');
    parts.push('          ... on CompositionComponentNode {');
    parts.push('            nodeType');
    parts.push('            component {');
    parts.push('              _metadata { types }');
    parts.push('              ...AllComponents');
    parts.push('            }');
    parts.push('          }');
    parts.push('        }');  // Close grids: nodes (line 982)
    parts.push('      }');    // Close composition (line 983)
    parts.push('    }');      // Close items (line 984)
    parts.push('  }');        // Close BlankExperience (line 985)
    parts.push('}');          // Close query (line 986)

    const query = parts.join('\n');

    // Debug: Write query to file for inspection
    const fs = await import('fs');
    fs.writeFileSync('debug-visual-builder-query.graphql', query);
    this.logger.info('Visual Builder query written to debug-visual-builder-query.graphql');

    return query;
  }

  /**
   * Build dynamic GraphQL query based on discovered fields
   * Supports inline fragments for querying specific types via base interfaces
   * Conditionally includes fragment definition for Visual Builder pages
   */
  private async buildDynamicQuery(
    queryType: string,
    specificType: string,
    key: string,
    locale: string,
    fields: FieldInfo[],
    options: GetInput
  ): Promise<string> {
    // Reset fragment flag
    this.needsFragments = false;

    const parts: string[] = [];
    const useInlineFragment = queryType !== specificType;

    // Check if this content type needs fragments (has composition field)
    const hasComposition = await this.hasCompositionField(specificType);

    // Build field projections (this will set needsFragments flag if composition is included)
    const fieldProjections: string[] = [];
    for (const field of fields) {
      if (field.name.startsWith('_')) continue; // Skip metadata fields

      const indent = useInlineFragment ? '        ' : '      ';
      const projection = await this.getFieldProjection(field, options);
      fieldProjections.push(`${indent}${field.name}${projection}`);
    }

    // Add fragment definitions ONLY if needed (Visual Builder pages with resolveDepth >= 2)
    if (this.needsFragments && hasComposition) {
      this.logger.info('Including AllComponents fragment in query');
      this.logger.info('Adding supporting fragments to parts array');

      // Add ContentUrl fragment (for ContentReference fields - images, videos, assets)
      // CRITICAL: ContentReference fields need url object, not id/workId/guidValue
      parts.push('fragment ContentUrl on ContentReference {');
      parts.push('  url {');
      parts.push('    default');
      parts.push('    hierarchical');
      parts.push('  }');
      parts.push('}');
      parts.push('');

      // Add LinkCollection fragment (for simple Link fields)
      parts.push('fragment LinkCollection on Link {');
      parts.push('  text');
      parts.push('  url {');
      parts.push('    default');
      parts.push('  }');
      parts.push('}');
      parts.push('');

      // Add LinkUrl fragment (for full Link fields with all properties)
      parts.push('fragment LinkUrl on Link {');
      parts.push('  url {');
      parts.push('    default');
      parts.push('    hierarchical');
      parts.push('  }');
      parts.push('  title');
      parts.push('  target');
      parts.push('  text');
      parts.push('}');
      parts.push('');

      // Add DisplaySettings fragment (required for displaySettings field)
      parts.push('fragment DisplaySettings on CompositionDisplaySetting {');
      parts.push('  key');
      parts.push('  value');
      parts.push('}');
      parts.push('');

      this.logger.info(`Parts array length after support fragments: ${parts.length}`);

      // Add AllComponents fragment
      const fragment = await this.getAllComponentsFragment();
      parts.push(fragment);
      parts.push(''); // Blank line separator

      this.logger.info(`Parts array length after AllComponents: ${parts.length}`);
      this.logger.info(`First part: ${parts[0]}`);
    }

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

    // Add field projections
    parts.push(...fieldProjections);

    // Close inline fragment if used
    if (useInlineFragment) {
      parts.push('      }');
    }

    parts.push('    }');
    parts.push('  }');
    parts.push('}');

    const query = parts.join('\n');

    // Debug: Write query to file for inspection
    try {
      const fs = await import('fs');
      fs.writeFileSync('debug-get-query.graphql', query);
      this.logger.info('Query saved to debug-get-query.graphql for inspection');
    } catch (e) {
      this.logger.warn('Could not save debug query', { error: e });
    }

    return query;
  }

  /**
   * Get field projection (for nested types like RichText)
   */
  private async getFieldProjection(field: FieldInfo, options: GetInput): Promise<string> {
    const type = field.type.toLowerCase();

    // Rich text fields - always get both html and json
    if (type.includes('richtext')) {
      return ' { html json }';
    }

    // Visual Builder composition structures
    if (type.includes('composition')) {
      return await this.getCompositionProjection(options.resolveDepth);
    }

    // Property/Settings objects - these are complex OBJECT types that require field selections
    // Examples: PageSeoSettingsProperty, PageAdminSettingsProperty
    if (type.includes('property') || type.includes('settings') || type.includes('config')) {
      return await this.getPropertyProjection(field.type);
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
   * Generate projection for property/settings object types
   * These are complex objects that require field selections
   * Uses introspection to discover scalar fields dynamically
   */
  private async getPropertyProjection(typeName: string): Promise<string> {
    try {
      // Introspect the property type to get its fields
      const typeInfo = await this.introspector!.getContentType(typeName);

      if (!typeInfo || !typeInfo.fields || typeInfo.fields.length === 0) {
        // Fallback to just __typename if we can't introspect
        return ' { __typename }';
      }

      // Build projection with all scalar fields (no complex nested types for now)
      const fields = ['__typename'];

      for (const field of typeInfo.fields) {
        const fieldType = field.type.toLowerCase();
        // Include only scalar types
        if (fieldType.includes('string') ||
            fieldType.includes('int') ||
            fieldType.includes('float') ||
            fieldType.includes('boolean') ||
            fieldType.includes('date')) {
          fields.push(field.name);
        }
      }

      return ' { ' + fields.join(' ') + ' }';
    } catch (error) {
      this.logger.warn(`Failed to introspect property type ${typeName}: ${error.message}`);
      return ' { __typename }';
    }
  }

  /**
   * Generate GraphQL projection for a specific component type
   * Discovers fields dynamically and builds inline fragment
   *
   * @param componentType - The component type name (e.g., "Hero", "Paragraph")
   * @returns Inline fragment with component fields
   */
  private async getComponentFieldsProjection(componentType: string): Promise<string> {
    // Check cache first
    if (this.componentProjectionCache.has(componentType)) {
      return this.componentProjectionCache.get(componentType)!;
    }

    try {
      // Introspect the component type to get its fields
      const typeInfo = await this.introspector!.getContentType(componentType);

      if (!typeInfo || !typeInfo.fields || typeInfo.fields.length === 0) {
        this.logger.debug(`No fields found for component type ${componentType}`);
        return '';
      }

      const parts: string[] = [];
      parts.push(`... on ${componentType} {`);

      // Add discovered fields (skip metadata fields, we already have those)
      for (const field of typeInfo.fields) {
        if (field.name.startsWith('_')) continue; // Skip metadata

        const fieldType = field.type.toLowerCase();

        // Handle different field types
        if (fieldType.includes('richtext') || fieldType.includes('searchablerichtext')) {
          // Rich text needs html and json projection
          parts.push(`  ${field.name} { html json }`);
        } else if (fieldType.includes('contentreference')) {
          // Content reference - just get the key
          parts.push(`  ${field.name} { key }`);
        } else if (fieldType.includes('link')) {
          // Link type - get common link fields
          parts.push(`  ${field.name} { title text url }`);
        } else if (fieldType.includes('string') ||
                   fieldType.includes('int') ||
                   fieldType.includes('float') ||
                   fieldType.includes('boolean') ||
                   fieldType.includes('date')) {
          // Scalar types - direct query
          parts.push(`  ${field.name}`);
        }
        // Skip complex nested types for now
      }

      parts.push('}');
      const projection = parts.join('\n');

      // Cache the projection
      this.componentProjectionCache.set(componentType, projection);
      return projection;
    } catch (error) {
      this.logger.warn(`Failed to generate projection for component ${componentType}: ${error.message}`);
      // Cache empty result to avoid repeated failures
      this.componentProjectionCache.set(componentType, '');
      return '';
    }
  }

  /**
   * Get common component types that might be used in Visual Builder
   * Discovers component types dynamically from the schema
   */
  private async getCommonComponentTypes(): Promise<string[]> {
    // Check cache first
    if (this.componentTypesCache !== null) {
      return this.componentTypesCache;
    }

    try {
      // Get all types that implement _IComponent interface
      const queryFields = await this.introspector!.getQueryFields();

      // Common component type patterns (these are typical but not hardcoded requirements)
      // Start with a smaller set for performance
      const commonPatterns = ['Hero', 'Paragraph', 'Text', 'Divider'];

      // Filter to types that likely exist in this CMS instance
      // We'll be conservative and query for the most common ones
      const componentTypes: string[] = [];

      for (const pattern of commonPatterns) {
        try {
          const typeInfo = await this.introspector!.getContentType(pattern);
          if (typeInfo && typeInfo.fields && typeInfo.fields.length > 0) {
            componentTypes.push(pattern);
          }
        } catch {
          // Type doesn't exist, skip it
        }
      }

      // Cache the discovered types
      this.componentTypesCache = componentTypes;
      return componentTypes;
    } catch (error) {
      this.logger.warn(`Failed to discover component types: ${error.message}`);
      this.componentTypesCache = [];
      return [];
    }
  }

  /**
   * Generate GraphQL projection for Visual Builder composition structures
   * Creates a recursive query that traverses: sections → rows → columns → components
   *
   * @param depth - How many levels deep to resolve (0 = just metadata, 3 = full structure with component fields)
   * @returns GraphQL projection fragment
   */
  private async getCompositionProjection(depth: number): Promise<string> {
    if (depth < 1) {
      // Just return basic composition metadata
      return ' { key displayName nodeType }';
    }

    // Mark that this query needs fragments (for buildDynamicQuery)
    if (depth >= 2) {
      this.needsFragments = true;
    }

    // Build composition structure based on user's working pattern analysis
    // Critical fixes applied:
    // 1. Fields BEFORE type condition at grid level
    // 2. Required fields: displayTemplateKey, displaySettings at all structure nodes
    // 3. nodeType without alias
    // 4. Component node needs: key, displayTemplateKey, displaySettings
    const parts: string[] = [];
    parts.push(' {');
    parts.push('    grids: nodes {');

    if (depth >= 2) {
      // Fix #3: Fields BEFORE the type condition
      parts.push('      key');
      parts.push('      displayName');
      parts.push('      displayTemplateKey');  // Fix #2: REQUIRED field
      parts.push('      displaySettings {');   // Fix #2: REQUIRED field - array of objects
      parts.push('        ...DisplaySettings');
      parts.push('      }');

      // Now the type condition
      parts.push('      ... on CompositionStructureNode {');
      parts.push('        nodeType');  // Fix #5: No alias
      parts.push('        key');

      if (depth >= 3) {
        parts.push('        rows: nodes {');
        // Rows level - same pattern
        parts.push('          ... on CompositionStructureNode {');
        parts.push('            nodeType');
        parts.push('            key');
        parts.push('            displayTemplateKey');  // Fix #2
        parts.push('            displaySettings {');
        parts.push('              ...DisplaySettings');
        parts.push('            }');
        parts.push('            columns: nodes {');
        parts.push('              ... on CompositionStructureNode {');
        parts.push('                nodeType');
        parts.push('                key');
        parts.push('                displayTemplateKey');  // Fix #2
        parts.push('                displaySettings {');
        parts.push('                  ...DisplaySettings');
        parts.push('                }');
        parts.push('                nodes {');
        parts.push('                  ... on CompositionComponentNode {');
        // Fix #4: Component node needs these fields
        parts.push('                    key');
        parts.push('                    displayTemplateKey');
        parts.push('                    displaySettings {');
        parts.push('                      ...DisplaySettings');
        parts.push('                    }');
        parts.push('                    component {');
        parts.push('                      _metadata {');
        parts.push('                        types');
        parts.push('                      }');
        parts.push('                      ...AllComponents');
        parts.push('                    }');
        parts.push('                  }');
        parts.push('                }');
        parts.push('              }');
        parts.push('            }');
        parts.push('          }');
        parts.push('        }');
      }

      parts.push('      }');

      // Grid-level components (components at grid level)
      parts.push('      ... on CompositionComponentNode {');
      parts.push('        nodeType');
      parts.push('        key');
      parts.push('        displayTemplateKey');
      parts.push('        displaySettings {');
      parts.push('          ...DisplaySettings');
      parts.push('        }');
      parts.push('        component {');
      parts.push('          _metadata {');
      parts.push('            types');
      parts.push('          }');
      parts.push('          ...AllComponents');
      parts.push('        }');
      parts.push('      }');
    }

    parts.push('    }');
    parts.push('  }');

    return parts.join('\n');
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
    partialResult?: boolean;
    enrichmentError?: string;
    suggestion?: string;
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
  displayName?: string;
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
