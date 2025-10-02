import { z } from 'zod';
import { BaseTool } from '../base-tool.js';
import type { ToolContext } from '../../types/tools.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { NotFoundError } from '../../utils/errors.js';
import { DiscoveryCache } from '../../services/discovery-cache.js';

/**
 * Retrieve tool - Get full content from Content Management API
 * 
 * This tool provides complete content retrieval with all details:
 * - Full property values including complex types
 * - Composition data (blocks, nested content)
 * - Version history
 * - Language variations
 * - Content type schema information
 * 
 * Use this when you need the complete content data for editing
 * or detailed analysis, not just metadata.
 */
export class RetrieveTool extends BaseTool<RetrieveInput, RetrieveOutput> {
  protected readonly name = 'retrieve';
  protected readonly description = `Get complete content data from Content Management API.

Use this when you need full content details for editing or detailed analysis.

Workflow:
1. Use 'search' or 'locate' to find content
2. Use 'retrieve' with the content ID/key to get full details

Example: retrieve({"identifier": "12345", "includeSchema": true})

This tool provides complete property values, block data, and version info.`;
  
  protected readonly inputSchema = z.object({
    identifier: z.string().describe('Content ID, key, or path'),
    locale: z.string().default('en').describe('Content locale'),
    version: z.string().optional().describe('Specific version to retrieve'),
    includeSchema: z.boolean().default(false).describe('Include content type schema'),
    includeVersions: z.boolean().default(false).describe('Include version history'),
    includeLanguages: z.boolean().default(false).describe('Include all language versions'),
    resolveBlocks: z.boolean().default(true).describe('Resolve block references'),
    resolveDepth: z.number().min(1).max(5).default(3).describe('Depth for resolving references')
  });

  private discoveryCache: DiscoveryCache | null = null;

  async initialize(context: ToolContext): Promise<void> {
    this.discoveryCache = new DiscoveryCache(context.config);
  }

  protected async run(input: RetrieveInput, context: ToolContext): Promise<RetrieveOutput> {
    if (!this.discoveryCache) {
      await this.initialize(context);
    }

    try {
      // First, locate the content using Graph API to get the key
      const contentKey = await this.resolveContentKey(input.identifier, input.locale, context);

      // Create CMA client
      const cmaClient = new OptimizelyContentClient({
        baseUrl: context.config.cma.baseUrl,
        clientId: context.config.cma.clientId,
        clientSecret: context.config.cma.clientSecret,
        grantType: context.config.cma.grantType,
        tokenEndpoint: context.config.cma.tokenEndpoint,
        impersonateUser: context.config.cma.impersonateUser,
        timeout: context.config.options.timeout,
        maxRetries: context.config.options.maxRetries
      });

      // Retrieve the main content
      const endpoint = input.version 
        ? `/experimental/content/${contentKey}/versions/${input.version}`
        : `/experimental/content/${contentKey}`;
      
      const content = await cmaClient.get(endpoint);

      // Build the output
      const output: RetrieveOutput = {
        content: await this.processContent(content, input, cmaClient),
        metadata: {
          retrieved: new Date().toISOString(),
          source: 'CMA',
          locale: input.locale
        }
      };

      // Add optional data
      if (input.includeSchema) {
        output.schema = await this.getContentTypeSchema(content.contentType[0], context);
      }

      if (input.includeVersions) {
        output.versions = await this.getVersionHistory(contentKey, cmaClient);
      }

      if (input.includeLanguages) {
        output.languages = await this.getLanguageVersions(contentKey, cmaClient);
      }

      return output;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new Error(`Failed to retrieve content: ${error.message}`);
    }
  }

  private async resolveContentKey(identifier: string, locale: string, context: ToolContext): Promise<string> {
    // If it's already a key format, return it
    if (/^\d+$/.test(identifier)) {
      return identifier;
    }

    // Use Graph API to find the content
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

    // Try to locate by path if it looks like a path
    if (identifier.startsWith('/')) {
      const query = `
        query LocateByPath($path: String!, $locale: [Locales!]) {
          _Content(
            locale: $locale,
            where: { _metadata: { url: { default: { eq: $path } } } },
            limit: 1
          ) {
            items {
              _metadata { key }
            }
          }
        }
      `;

      const result = await graphClient.query(query, { path: identifier, locale: [locale] });
      
      if (result._Content?.items?.length > 0) {
        return result._Content.items[0]._metadata.key;
      }
    }

    // Try as GUID
    const guidPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
    if (guidPattern.test(identifier)) {
      const query = `
        query LocateByGuid($guid: String!, $locale: [Locales!]) {
          _Content(
            locale: $locale,
            where: { _metadata: { guid: { eq: $guid } } },
            limit: 1
          ) {
            items {
              _metadata { key }
            }
          }
        }
      `;

      const result = await graphClient.query(query, { guid: identifier, locale: [locale] });
      
      if (result._Content?.items?.length > 0) {
        return result._Content.items[0]._metadata.key;
      }
    }

    throw new NotFoundError(`Content not found with identifier: ${identifier}`);
  }

  private async processContent(
    content: any, 
    input: RetrieveInput, 
    cmaClient: OptimizelyContentClient
  ): Promise<ProcessedContent> {
    const processed: ProcessedContent = {
      key: content.key,
      guid: content.guid,
      name: content.name,
      displayName: content.displayName || content.name,
      contentType: content.contentType,
      parentLink: content.parentLink,
      status: content.status,
      created: content.created,
      createdBy: content.createdBy,
      changed: content.changed,
      changedBy: content.changedBy,
      published: content.published,
      properties: {}
    };

    // Process properties with optional block resolution
    for (const [key, value] of Object.entries(content)) {
      // Skip metadata fields
      if (['key', 'guid', 'name', 'displayName', 'contentType', 'parentLink', 
           'status', 'created', 'createdBy', 'changed', 'changedBy', 'published'].includes(key)) {
        continue;
      }

      processed.properties[key] = input.resolveBlocks 
        ? await this.resolvePropertyValue(value, input.resolveDepth, cmaClient)
        : value;
    }

    return processed;
  }

  private async resolvePropertyValue(
    value: any, 
    depth: number, 
    cmaClient: OptimizelyContentClient
  ): Promise<any> {
    if (depth <= 0 || !value) return value;

    // Handle arrays
    if (Array.isArray(value)) {
      return Promise.all(value.map(v => this.resolvePropertyValue(v, depth, cmaClient)));
    }

    // Handle block references
    if (value && typeof value === 'object' && value.key) {
      try {
        const block = await cmaClient.get(`/experimental/content/${value.key}`);
        return {
          ...value,
          _resolved: await this.processContent(block, { resolveDepth: depth - 1 } as any, cmaClient)
        };
      } catch (error) {
        // If we can't resolve, return the reference as-is
        return value;
      }
    }

    // Handle nested objects
    if (value && typeof value === 'object') {
      const resolved: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        resolved[k] = await this.resolvePropertyValue(v, depth, cmaClient);
      }
      return resolved;
    }

    return value;
  }

  private async getContentTypeSchema(contentType: string, context: ToolContext): Promise<ContentTypeSchema> {
    const schema = await this.discoveryCache!.getContentTypeSchema(contentType);
    
    return {
      name: schema.name,
      displayName: schema.displayName || schema.name,
      description: schema.description,
      category: schema.category,
      baseType: schema.baseType,
      properties: schema.properties || []
    };
  }

  private async getVersionHistory(
    contentKey: string, 
    cmaClient: OptimizelyContentClient
  ): Promise<VersionInfo[]> {
    try {
      const versions = await cmaClient.get(`/experimental/content/${contentKey}/versions`);
      
      return versions.map((v: any) => ({
        id: v.id,
        status: v.status,
        language: v.language,
        created: v.created,
        createdBy: v.createdBy,
        changed: v.changed,
        changedBy: v.changedBy,
        published: v.published,
        publishedBy: v.publishedBy,
        isMasterVersion: v.isMasterVersion
      }));
    } catch (error) {
      return [];
    }
  }

  private async getLanguageVersions(
    contentKey: string, 
    cmaClient: OptimizelyContentClient
  ): Promise<LanguageInfo[]> {
    try {
      const languages = await cmaClient.get(`/content/${contentKey}/languages`);
      
      return languages.map((lang: any) => ({
        language: lang.language,
        displayName: lang.displayName,
        isMasterLanguage: lang.isMasterLanguage,
        isAvailable: lang.isAvailable,
        isPublished: lang.isPublished,
        version: lang.version
      }));
    } catch (error) {
      return [];
    }
  }
}

// Type definitions
interface RetrieveInput {
  identifier: string;
  locale: string;
  version?: string;
  includeSchema: boolean;
  includeVersions: boolean;
  includeLanguages: boolean;
  resolveBlocks: boolean;
  resolveDepth: number;
}

interface RetrieveOutput {
  content: ProcessedContent;
  metadata: {
    retrieved: string;
    source: string;
    locale: string;
  };
  schema?: ContentTypeSchema;
  versions?: VersionInfo[];
  languages?: LanguageInfo[];
}

interface ProcessedContent {
  key: string;
  guid: string;
  name: string;
  displayName: string;
  contentType: string[];
  parentLink?: string;
  status: string;
  created: string;
  createdBy: string;
  changed: string;
  changedBy: string;
  published?: string;
  properties: Record<string, any>;
}

interface ContentTypeSchema {
  name: string;
  displayName: string;
  description?: string;
  category?: string;
  baseType?: string;
  properties: Array<{
    name: string;
    type: string;
    required: boolean;
    searchable?: boolean;
    [key: string]: any;
  }>;
}

interface VersionInfo {
  id: string;
  status: string;
  language: string;
  created: string;
  createdBy: string;
  changed: string;
  changedBy: string;
  published?: string;
  publishedBy?: string;
  isMasterVersion: boolean;
}

interface LanguageInfo {
  language: string;
  displayName: string;
  isMasterLanguage: boolean;
  isAvailable: boolean;
  isPublished: boolean;
  version: string;
}