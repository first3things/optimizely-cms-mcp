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
  protected readonly description = 'Find specific content by ID or path using Graph API';
  
  protected readonly inputSchema = z.object({
    identifier: z.string().describe('Content ID, key, GUID, or URL path'),
    identifierType: z.enum(['auto', 'id', 'key', 'guid', 'path']).default('auto').describe('Type of identifier'),
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

    // GUID pattern (with or without hyphens)
    const guidPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
    if (guidPattern.test(identifier)) {
      return { type: 'guid', normalizedId: identifier.replace(/-/g, '') };
    }

    // URL path (starts with /)
    if (identifier.startsWith('/')) {
      return { type: 'path', normalizedId: identifier };
    }

    // Key pattern (numeric_locale format)
    if (/^\d+(_[a-z]{2})?$/i.test(identifier)) {
      return { type: 'key', normalizedId: identifier };
    }

    // Default to ID (could be numeric or custom format)
    return { type: 'id', normalizedId: identifier };
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
      case 'guid':
        return '{ _metadata: { guid: { eq: $identifier } } }';
      case 'path':
        return '{ _metadata: { url: { default: { eq: $path } } } }';
      case 'id':
      default:
        // Try multiple fields for ID
        return `{
          _or: [
            { _metadata: { key: { eq: $identifier } } },
            { _metadata: { guid: { eq: $identifier } } }
          ]
        }`;
    }
  }

  private buildFieldSelection(input: LocateInput): string {
    const fields: string[] = [];

    // Always include core metadata
    fields.push('      _metadata {');
    fields.push('        key');
    fields.push('        guid');
    fields.push('        version');
    fields.push('        locale');
    fields.push('        displayName');
    fields.push('        status');
    fields.push('        url {');
    fields.push('          default');
    fields.push('          internal');
    fields.push('        }');
    fields.push('        published');
    fields.push('        lastModified');
    fields.push('        created');
    fields.push('        createdBy');
    fields.push('        lastModifiedBy');
    fields.push('        types');
    fields.push('      }');
    fields.push('      _type: __typename');

    // Include parent reference
    fields.push('      _metadata {');
    fields.push('        container');
    fields.push('      }');

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
        guid: metadata.guid,
        type: content._type,
        displayName: metadata.displayName,
        status: metadata.status,
        locale: metadata.locale,
        version: metadata.version,
        url: metadata.url?.default,
        internalUrl: metadata.url?.internal,
        created: metadata.created,
        createdBy: metadata.createdBy,
        lastModified: metadata.lastModified,
        lastModifiedBy: metadata.lastModifiedBy,
        published: metadata.published,
        container: metadata.container,
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
  guid?: string;
  type: string;
  displayName: string;
  status: string;
  locale: string;
  version: string;
  url?: string;
  internalUrl?: string;
  created: string;
  createdBy: string;
  lastModified: string;
  lastModifiedBy: string;
  published?: string;
  container?: string;
  contentTypes: string[];
}

interface ContentReference {
  id: string;
  displayName: string;
  type: string;
  url?: string;
}