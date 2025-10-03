import { z } from 'zod';
import { BaseTool } from '../base-tool.js';
import type { ToolContext } from '../../types/tools.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';

/**
 * Locate tool - Find specific content by ID or path
 * 
 * This tool provides precise content location capabilities:
 * - Find by content ID/key
 * - Find by URL path
 * - Find by GUID
 * - Resolve content references
 * - Support for specific locale and version
 * 
 * Unlike search, this tool is for when you know exactly what
 * content you're looking for and need its metadata quickly.
 */
export class LocateTool extends BaseTool<LocateInput, LocateOutput> {
  protected readonly name = 'locate';
  protected readonly description = `Find specific content by ID, key, or URL path.

This tool auto-detects the identifier type or you can specify it explicitly.

Examples:
- By path: locate({"identifier": "/news/article-1"})
- By key: locate({"identifier": "f3e8ef7f63ac45758a1dca8fbbde8d82"})
- By key with hyphens: locate({"identifier": "f3e8ef7f-63ac-4575-8a1d-ca8fbbde8d82"})

The tool will return detailed metadata about the found content.`;
  
  protected readonly inputSchema = z.object({
    identifier: z.string().describe('Content ID, key, or URL path'),
    identifierType: z.enum(['auto', 'id', 'key', 'path']).default('auto').describe('Type of identifier'),
    locale: z.string().default('en').describe('Content locale'),
    version: z.string().optional().describe('Specific version to retrieve'),
    includeChildren: z.boolean().default(false).describe('Include child content'),
    includeAncestors: z.boolean().default(false).describe('Include ancestor content'),
    depth: z.number().min(0).max(5).default(1).describe('Depth for children/ancestors')
  });

  protected async run(input: LocateInput, context: ToolContext): Promise<LocateOutput> {
    // Validate and normalize the identifier
    const { type: actualType, normalizedId } = this.detectIdentifierType(input.identifier, input.identifierType);

    try {
      // Build the appropriate query based on identifier type
      const query = this.buildLocateQuery(actualType, input);
      const variables = this.buildVariables(actualType, normalizedId, input);

      // Execute the query
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

      // Process and validate results
      return this.processLocateResults(result, actualType, input);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new Error(`Failed to locate content: ${error.message}`);
    }
  }

  private detectIdentifierType(identifier: string, hint: string): { type: string; normalizedId: string } {
    // If hint is provided and not auto, use it
    if (hint !== 'auto') {
      return { type: hint, normalizedId: identifier };
    }

    // Auto-detect the type
    identifier = identifier.trim();

    // URL path (starts with /)
    if (identifier.startsWith('/')) {
      return { type: 'path', normalizedId: identifier };
    }

    // Key pattern - 32 hex chars (with or without hyphens)
    // This covers both GUID-like format and actual keys
    const keyPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
    const simpleKeyPattern = /^[0-9a-f]{32}$/i;
    
    if (keyPattern.test(identifier) || simpleKeyPattern.test(identifier)) {
      // Remove hyphens to get key format
      return { type: 'key', normalizedId: identifier.replace(/-/g, '') };
    }

    // Numeric key pattern (older format)
    if (/^\d+(_[a-z]{2})?$/i.test(identifier)) {
      return { type: 'key', normalizedId: identifier };
    }

    // Default to key (most flexible)
    return { type: 'key', normalizedId: identifier };
  }

  private buildLocateQuery(identifierType: string, input: LocateInput): string {
    const parts: string[] = [];

    // Query header
    parts.push('query LocateContent(');
    parts.push('  $locale: [Locales!],');
    
    if (identifierType === 'path') {
      parts.push('  $path: String!');
    } else {
      parts.push('  $identifier: String!');
    }
    
    parts.push(') {');

    // Main content query
    parts.push('  _Content(');
    parts.push('    locale: $locale,');
    parts.push('    limit: 1,');
    
    // Add where clause based on identifier type
    const whereClause = this.buildWhereClause(identifierType);
    parts.push(`    where: ${whereClause}`);
    
    parts.push('  ) {');
    parts.push('    items {');
    parts.push(this.buildFieldSelection(input));
    parts.push('    }');
    parts.push('  }');
    parts.push('}');

    return parts.join('\n');
  }

  private buildWhereClause(identifierType: string): string {
    switch (identifierType) {
      case 'key':
        return '{ _metadata: { key: { eq: $identifier } } }';
      case 'path':
        return '{ _metadata: { url: { hierarchical: { eq: $path } } } }';
      case 'id':
      default:
        // For ID, just use key
        return '{ _metadata: { key: { eq: $identifier } } }';
    }
  }

  private buildFieldSelection(input: LocateInput): string {
    const fields: string[] = [];

    // Always include core metadata
    fields.push('      _metadata {');
    fields.push('        key');
    fields.push('        version');
    fields.push('        locale');
    fields.push('        displayName');
    fields.push('        status');
    fields.push('        url {');
    fields.push('          default');
    fields.push('          internal');
    fields.push('          hierarchical');
    fields.push('        }');
    fields.push('        published');
    fields.push('        lastModified');
    fields.push('        created');
    fields.push('        types');
    fields.push('      }');
    fields.push('      _type: __typename');

    // Include children if requested
    if (input.includeChildren) {
      fields.push(this.buildChildrenQuery(input.depth));
    }

    // Include ancestors if requested
    if (input.includeAncestors) {
      fields.push(this.buildAncestorsQuery(input.depth));
    }

    // Include basic content fields
    fields.push('      ... on _IContent {');
    fields.push('        name: _metadata { displayName }');
    fields.push('      }');

    return fields.join('\n');
  }

  private buildChildrenQuery(depth: number): string {
    if (depth <= 0) return '';

    return `
      _children: _Content(
        where: { _metadata: { container: { eq: $identifier } } },
        limit: 100
      ) {
        items {
          _metadata {
            key
            displayName
            types
            url { default }
          }
          ${depth > 1 ? this.buildChildrenQuery(depth - 1) : ''}
        }
      }`;
  }

  private buildAncestorsQuery(depth: number): string {
    // Ancestors need to be resolved through parent references
    // This is simplified - real implementation would need recursive queries
    return `
      _parent {
        _metadata {
          key
          displayName
          types
          url { default }
        }
      }`;
  }

  private buildVariables(identifierType: string, identifier: string, input: LocateInput): Record<string, any> {
    const variables: Record<string, any> = {
      locale: [input.locale]
    };

    if (identifierType === 'path') {
      variables.path = identifier;
    } else {
      variables.identifier = identifier;
    }

    return variables;
  }

  private processLocateResults(result: any, identifierType: string, input: LocateInput): LocateOutput {
    const items = result._Content?.items || [];
    
    if (items.length === 0) {
      throw new NotFoundError(
        `Content not found: ${input.identifier} (type: ${identifierType})`,
        { identifier: input.identifier, type: identifierType }
      );
    }

    const content = items[0];
    const metadata = content._metadata;

    const output: LocateOutput = {
      found: true,
      content: {
        id: metadata.key,
        type: content._type,
        displayName: metadata.displayName,
        status: metadata.status,
        locale: metadata.locale,
        version: metadata.version,
        url: metadata.url?.default,
        internalUrl: metadata.url?.internal,
        hierarchicalUrl: metadata.url?.hierarchical,
        created: metadata.created,
        lastModified: metadata.lastModified,
        published: metadata.published,
        contentTypes: metadata.types || []
      },
      identifierUsed: input.identifier,
      identifierType: identifierType
    };

    // Add children if included
    if (input.includeChildren && content._children) {
      output.children = content._children.items.map((child: any) => ({
        id: child._metadata.key,
        displayName: child._metadata.displayName,
        type: child._metadata.types?.[0] || 'Unknown',
        url: child._metadata.url?.default
      }));
    }

    // Add parent if included
    if (input.includeAncestors && content._parent) {
      output.ancestors = [{
        id: content._parent._metadata.key,
        displayName: content._parent._metadata.displayName,
        type: content._parent._metadata.types?.[0] || 'Unknown',
        url: content._parent._metadata.url?.default
      }];
    }

    return output;
  }
}

// Type definitions
interface LocateInput {
  identifier: string;
  identifierType: 'auto' | 'id' | 'key' | 'guid' | 'path';
  locale: string;
  version?: string;
  includeChildren: boolean;
  includeAncestors: boolean;
  depth: number;
}

interface LocateOutput {
  found: boolean;
  content: ContentLocation;
  identifierUsed: string;
  identifierType: string;
  children?: ContentReference[];
  ancestors?: ContentReference[];
}

interface ContentLocation {
  id: string;
  type: string;
  displayName: string;
  status: string;
  locale: string;
  version: string;
  url?: string;
  internalUrl?: string;
  hierarchicalUrl?: string;
  created: string;
  lastModified: string;
  published?: string;
  contentTypes: string[];
}

interface ContentReference {
  id: string;
  displayName: string;
  type: string;
  url?: string;
}